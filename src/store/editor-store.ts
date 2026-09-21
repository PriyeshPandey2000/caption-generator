import { create } from "zustand";
import {
  Project,
  WordStyle,
  WordMotion,
  WordTransform,
  GlobalStyle,
  TranscriptionResult,
  SfxDensity,
  SfxVolume,
  SfxPackId,
  SfxName,
  Composition,
  PreviewPlatform,
  DictionaryEntry,
  BackgroundMode,
} from "@/core/types";
import { defaultGlobalStyle } from "@/core/styles";
import { groupWordsIntoCaptions } from "@/core/captions";
import { preprocessBackgroundImage } from "@/core/background-image";
import { isSingleToken } from "@/core/dictionary";
import { createDemoTranscription, DEMO_VIDEO_URL } from "@/core/demo";
import { ChoreographyBundle, highlightEmphasisWords } from "@/core/choreography";
import {
  saveProjectToStorage,
  saveVideoToStorage,
  clearProjectFromStorage,
  clearVideoFromStorage,
  saveBackgroundImageToStorage,
  clearBackgroundImageFromStorage,
} from "@/core/persistence";
import {
  buildCameraTimeline,
  mergeOverlapping,
  sliderIntensityToScale,
  fractionalIntensityToScale,
} from "@/core/zoom";
import { buildSfxTimeline } from "@/core/sfx";
import { v4 as uuid } from "uuid";

export interface GroupLayout {
  x: number;
  y: number;
  scale: number;
}

interface EditorState {
  project: Project;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  selectedWordIds: string[];
  selectedCaptionGroupId: string | null;
  videoFile: File | null;
  videoUrl: string | null;
  previewPlatform: PreviewPlatform;

  setVideoFile: (file: File) => void;
  setRestoredVideo: (file: File, url: string) => void;
  setPreviewPlatform: (platform: PreviewPlatform) => void;
  setTranscription: (result: TranscriptionResult) => void;
  setIsTranscribing: (v: boolean) => void;
  setError: (error: string | null) => void;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (v: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  selectWord: (id: string, multi?: boolean) => void;
  setSelectedWords: (ids: string[]) => void;
  selectCaptionGroup: (id: string | null) => void;
  clearSelection: () => void;

  updateWordStyle: (wordId: string, style: Partial<WordStyle>) => void;
  updateWordMotion: (wordId: string, motion: Partial<WordMotion>) => void;
  updateWordTransform: (wordId: string, transform: Partial<WordTransform>) => void;
  updateWordText: (wordId: string, text: string) => void;
  updateGlobalStyle: (style: Partial<GlobalStyle>) => void;
  updateSpeakerStyle: (speaker: string, style: Partial<WordStyle>) => void;
  updateSpeakerMotion: (speaker: string, motion: Partial<WordMotion>) => void;
  resetWordStyle: (wordId: string) => void;
  resetWordMotion: (wordId: string) => void;
  addDictionaryEntry: (from: string, to: string) => void;
  removeDictionaryEntry: (id: string) => void;
  loadDemo: () => void;
  applyChoreography: (bundle: ChoreographyBundle) => void;
  groupLayouts: Record<string, GroupLayout>;
  updateGroupLayout: (groupId: string, partial: Partial<GroupLayout>) => void;
  resetGroupLayout: (groupId: string) => void;

  retimeWord: (wordId: string, start: number, end: number) => void;
  regroupCaptions: () => void;
  setMaxWordsPerGroup: (n: number) => void;
  applyPreset: (preset: Partial<GlobalStyle>) => void;
  toggleCameraMovement: (enabled: boolean) => void;
  setCameraIntensity: (intensity: number) => void;
  addManualCameraEvent: (wordId: string, intensity: number) => void;
  setSfxEnabled: (enabled: boolean) => void;
  setSfxDensity: (density: SfxDensity) => void;
  setSfxVolume: (volume: SfxVolume) => void;
  setSfxOffsetMs: (offsetMs: number) => void;
  setSfxPack: (pack: SfxPackId) => void;
  regenerateSfx: () => void;
  setSfxOverride: (wordId: string, val: "inherit" | "none" | SfxName) => void;
  addManualSfxEvent: (wordId: string, sound: SfxName) => void;
  setBackgroundMode: (mode: BackgroundMode) => void;
  setBackgroundColor: (color: string) => void;
  setBackgroundImage: (imageUrl: string | null) => void;
  setBackgroundImageFile: (file: File) => void;
  setBackgroundBlurAmount: (blurAmount: number) => void;
  restorePersisted: (data: {
    transcription: TranscriptionResult | null;
    globalStyle: GlobalStyle;
    composition?: Composition;
    speakerStyles: Record<string, Partial<WordStyle>>;
    speakerMotions: Record<string, Partial<WordMotion>>;
    dictionary?: DictionaryEntry[];
    groupLayouts: Record<string, GroupLayout>;
    demoMode?: boolean;
  }) => void;
  newProject: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const initialState: Project = {
  id: uuid(),
  name: "Untitled Project",
  videoUrl: "",
  transcription: null,
  globalStyle: { ...defaultGlobalStyle },
  composition: { sfxEvents: [] },
  speakerStyles: {},
  speakerMotions: {},
  dictionary: [],
  isTranscribing: false,
  error: null,
  demoMode: false,
};

// Serialize IndexedDB writes (video + background image). Both operations touch
// shared keys in the same store, so an in-flight save from an earlier selection
// must finish before a New Project clear — otherwise the stale write can commit
// *after* the clear and resurrect on the next reload.
let storageOpQueue: Promise<unknown> = Promise.resolve();
function enqueueStorageOp<T>(op: () => Promise<T>): Promise<T> {
  const run = storageOpQueue.then(op, op);
  storageOpQueue = run.catch(() => {});
  return run;
}

// --- Undo/redo history -------------------------------------------
//
// The documentable subset is what undo/redo tracks: the transcription (words,
// timing, styling), global/speaker styles, composition events, and group
// layouts. Everything else — playhead, play state, selection, the loaded video
// file/URL, transcription-in-progress and error banners — is UI/temporary and
// intentionally NOT tracked.
//
// Capturing happens in the subscribe listener below (compare by reference: the
// actions only replace an object when they actually change it), so no action
// needs an explicit tracking call. A 500ms coalescing window merges one gesture
// (a slider drag, a marquee, a rapid burst) into a single undo step.

interface DocSnapshot {
  project: {
    id: string;
    name: string;
    transcription: TranscriptionResult | null;
    globalStyle: GlobalStyle;
    composition: Composition;
    speakerStyles: Record<string, Partial<WordStyle>>;
    speakerMotions: Record<string, Partial<WordMotion>>;
  };
  groupLayouts: Record<string, GroupLayout>;
}

const HISTORY_LIMIT = 50;
const COALESCE_MS = 500;

let undoStack: DocSnapshot[] = [];
let redoStack: DocSnapshot[] = [];
let pendingBaseline: DocSnapshot | null = null;
let pendingSince = 0;
let suppressHistory = false;
// Monotonic token that increments each time the selected video changes or a
// new project starts. It scopes the asynchronous IndexedDB save-failure report
// so a stale `persisted === false` for an old blob can't set an error on
// newer state.
let videoSaveGeneration = 0;
// Monotonic token that increments each time the background image changes or a
// new project starts. Scopes the async IndexedDB save-failure report so a stale
// `persisted === false` for an old image can't set an error on newer state.
let backgroundImageSaveGeneration = 0;

function cloneDoc(s: EditorState): DocSnapshot {
  // The document subset is plain JSON-safe data (no functions/dates), so a
  // stringify round-trip is a safe deep clone.
  return JSON.parse(
    JSON.stringify({
      project: {
        id: s.project.id,
        name: s.project.name,
        transcription: s.project.transcription,
        globalStyle: s.project.globalStyle,
        composition: s.project.composition,
        speakerStyles: s.project.speakerStyles,
        speakerMotions: s.project.speakerMotions,
      },
      groupLayouts: s.groupLayouts,
    })
  );
}

function docChanged(curr: EditorState, prev: EditorState): boolean {
  return (
    curr.project.transcription !== prev.project.transcription ||
    curr.project.globalStyle !== prev.project.globalStyle ||
    curr.project.composition !== prev.project.composition ||
    curr.project.speakerStyles !== prev.project.speakerStyles ||
    curr.project.speakerMotions !== prev.project.speakerMotions ||
    curr.groupLayouts !== prev.groupLayouts
  );
}

function commitPendingBaseline(): void {
  if (!pendingBaseline) return;
  undoStack.push(pendingBaseline);
  pendingBaseline = null;
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  syncHistoryUI();
}

function syncHistoryUI(): void {
  useEditorStore.setState({
    canUndo: undoStack.length > 0 || pendingBaseline !== null,
    canRedo: redoStack.length > 0,
  });
}

export const useEditorStore = create<EditorState>((set) => ({
  project: initialState,
  currentTime: 0,
  isPlaying: false,
  playbackRate: 1,
  selectedWordIds: [],
  selectedCaptionGroupId: null,
  videoFile: null,
  videoUrl: null,
  previewPlatform: "none",
  groupLayouts: {},
  canUndo: false,
  canRedo: false,

  setVideoFile: (file) => {
    const gen = ++videoSaveGeneration;
    const url = URL.createObjectURL(file);
    const prevUrl = useEditorStore.getState().videoUrl;
    if (prevUrl && prevUrl.startsWith("blob:")) URL.revokeObjectURL(prevUrl);
    set((s) => ({
      videoFile: file,
      videoUrl: url,
      project: { ...s.project, demoMode: false },
    }));
    enqueueStorageOp(() =>
      saveVideoToStorage({ blob: file, name: file.name, type: file.type })
    ).then((persisted) => {
      // Only report a failure if this save's generation is still current; a
      // replacement or New Project after this save started means the result
      // belongs to a stale blob.
      if (!persisted && videoSaveGeneration === gen) {
        useEditorStore
          .getState()
          .setError(
            "Your video plays but couldn't be saved locally — it may disappear after a refresh. The browser may be blocking storage or out of space."
          );
      }
    });
  },

  setRestoredVideo: (file, url) => {
    const prevUrl = useEditorStore.getState().videoUrl;
    if (prevUrl && prevUrl.startsWith("blob:")) URL.revokeObjectURL(prevUrl);
    set({ videoFile: file, videoUrl: url });
  },

  setPreviewPlatform: (platform) => set({ previewPlatform: platform }),

  setTranscription: (result) => {
    set((s) => ({
      project: {
        ...s.project,
        transcription: result,
        isTranscribing: false,
        // Preserve any already-surfaced error (e.g. an earlier video
        // persistence failure whose async report arrived before the
        // transcription result). Committing a transcript must not silently
        // wipe the only warning the user got about video storage.
        error: s.project.error,
      },
    }));
  },

  setIsTranscribing: (v) =>
    set((s) => ({ project: { ...s.project, isTranscribing: v } })),

  setError: (error) =>
    set((s) => ({ project: { ...s.project, error } })),

  setCurrentTime: (t) => set({ currentTime: t }),

  setIsPlaying: (v) => set({ isPlaying: v }),

  setPlaybackRate: (rate) => set({ playbackRate: rate }),

  selectWord: (id, multi = false) =>
    set((s) => ({
      selectedWordIds: multi
        ? s.selectedWordIds.includes(id)
          ? s.selectedWordIds.filter((wid) => wid !== id)
          : [...s.selectedWordIds, id]
        : [id],
      selectedCaptionGroupId: null,
    })),

  setSelectedWords: (ids) =>
    set({ selectedWordIds: ids, selectedCaptionGroupId: null }),

  selectCaptionGroup: (id) =>
    set({ selectedCaptionGroupId: id, selectedWordIds: [] }),

  clearSelection: () =>
    set({ selectedWordIds: [], selectedCaptionGroupId: null }),

  updateWordStyle: (wordId, style) =>
    set((s) => {
      if (!s.project.transcription) return s;
      const words = s.project.transcription.words.map((w) =>
        w.id === wordId ? { ...w, style: { ...w.style, ...style } } : w
      );
      return {
        project: {
          ...s.project,
          transcription: { ...s.project.transcription, words },
        },
      };
    }),

  updateWordMotion: (wordId, motion) =>
    set((s) => {
      if (!s.project.transcription) return s;
      const words = s.project.transcription.words.map((w) =>
        w.id === wordId
          ? { ...w, animation: { ...w.animation, ...motion } }
          : w
      );
      return {
        project: {
          ...s.project,
          transcription: { ...s.project.transcription, words },
        },
      };
    }),

  updateWordTransform: (wordId, transform) =>
    set((s) => {
      if (!s.project.transcription) return s;
      const words = s.project.transcription.words.map((w) =>
        w.id === wordId
          ? { ...w, transform: { ...w.transform, ...transform } }
          : w
      );
      return {
        project: {
          ...s.project,
          transcription: { ...s.project.transcription, words },
        },
      };
    }),

  updateWordText: (wordId, text) =>
    set((s) => {
      if (!s.project.transcription) return s;
      const clean = String(text || "").trim();
      const words = s.project.transcription.words.map((w) =>
        w.id === wordId ? { ...w, text: clean || w.text } : w
      );
      return {
        project: {
          ...s.project,
          transcription: { ...s.project.transcription, words },
        },
      };
    }),

  updateGlobalStyle: (style) =>
    set((s) => ({
      project: {
        ...s.project,
        globalStyle: { ...s.project.globalStyle, ...style },
      },
    })),

  setBackgroundMode: (mode) =>
    set((s) => ({
      project: {
        ...s.project,
        globalStyle: {
          ...s.project.globalStyle,
          background: { ...s.project.globalStyle.background, mode },
        },
      },
    })),

  setBackgroundColor: (color) =>
    set((s) => ({
      project: {
        ...s.project,
        globalStyle: {
          ...s.project.globalStyle,
          background: { ...s.project.globalStyle.background, color },
        },
      },
    })),

  setBackgroundImage: (imageUrl) =>
    set((s) => ({
      project: {
        ...s.project,
        globalStyle: {
          ...s.project.globalStyle,
          background: { ...s.project.globalStyle.background, imageUrl },
        },
      },
    })),

  // Mirrors setVideoFile: keep the bytes in IndexedDB (object URLs don't
  // survive reloads) while the compositor uses a live object URL in-session.
  setBackgroundImageFile: (file) => {
    const gen = ++backgroundImageSaveGeneration;
    // Normalize the upload once (downscale oversized images, re-encode) so
    // every later composite draws at or near 1:1 instead of stretching a
    // multi-megapixel photo inside the per-frame compositor.
    void preprocessBackgroundImage(file).then((processed) => {
      // A later pick or New Project superseded this upload while it was still
      // decoding. Drop the result entirely: applying it would replace the
      // active background and persist stale bytes over the newer image.
      if (backgroundImageSaveGeneration !== gen) return;
      const finalFile = processed ?? file;
      const url = URL.createObjectURL(finalFile);
      // Revoke whatever blob was live when this became the current image (a
      // rejected save in the meantime or a restore can have changed it since
      // the pick was made), never the URL captured at call time.
      const prevUrl = useEditorStore.getState().project.globalStyle.background.imageUrl;
      if (prevUrl && prevUrl.startsWith("blob:")) URL.revokeObjectURL(prevUrl);
      set((s) => ({
        project: {
          ...s.project,
          globalStyle: {
            ...s.project.globalStyle,
            background: { ...s.project.globalStyle.background, imageUrl: url },
          },
        },
      }));
      enqueueStorageOp(() => saveBackgroundImageToStorage(finalFile)).then((persisted) => {
        // Only report a failure if this save's generation is still current; a
        // replacement or New Project after this save started means the result
        // belongs to a stale image.
        if (!persisted && backgroundImageSaveGeneration === gen) {
          useEditorStore
            .getState()
            .setError(
              "Your background image shows but couldn't be saved locally — it may disappear after a refresh. The browser may be blocking storage or out of space."
            );
        }
      });
    });
  },

  setBackgroundBlurAmount: (blurAmount) =>
    set((s) => ({
      project: {
        ...s.project,
        globalStyle: {
          ...s.project.globalStyle,
          background: { ...s.project.globalStyle.background, blurAmount },
        },
      },
    })),

  updateSpeakerStyle: (speaker, style) =>
    set((s) => ({
      project: {
        ...s.project,
        speakerStyles: {
          ...s.project.speakerStyles,
          [speaker]: { ...s.project.speakerStyles[speaker], ...style },
        },
      },
    })),

  updateSpeakerMotion: (speaker, motion) =>
    set((s) => ({
      project: {
        ...s.project,
        speakerMotions: {
          ...s.project.speakerMotions,
          [speaker]: { ...s.project.speakerMotions[speaker], ...motion },
        },
      },
    })),

  resetWordStyle: (wordId) =>
    set((s) => {
      if (!s.project.transcription) return s;
      const words = s.project.transcription.words.map((w) =>
        w.id === wordId ? { ...w, style: undefined } : w
      );
      return {
        project: {
          ...s.project,
          transcription: { ...s.project.transcription, words },
        },
      };
    }),

  resetWordMotion: (wordId) =>
    set((s) => {
      if (!s.project.transcription) return s;
      const words = s.project.transcription.words.map((w) =>
        w.id === wordId ? { ...w, animation: undefined } : w
      );
      return {
        project: {
          ...s.project,
          transcription: { ...s.project.transcription, words },
        },
      };
    }),

  addDictionaryEntry: (from, to) =>
    set((s) => {
      const trimmedFrom = from.trim();
      const trimmedTo = to.trim();
      // A dictionary correction maps one mis-heard token to its replacement.
      // Multi-word values are not representable in the word model (a Word is a
      // single token with one timestamp), so reject them here.
      if (!isSingleToken(trimmedFrom) || !isSingleToken(trimmedTo)) return s;
      return {
        project: {
          ...s.project,
          dictionary: [
            ...s.project.dictionary,
            { id: uuid(), from: trimmedFrom, to: trimmedTo },
          ],
        },
      };
    }),

  removeDictionaryEntry: (id) =>
    set((s) => ({
      project: {
        ...s.project,
        dictionary: s.project.dictionary.filter((e) => e.id !== id),
      },
    })),

  loadDemo: () => {
    const prevUrl = useEditorStore.getState().videoUrl;
    if (prevUrl && prevUrl.startsWith("blob:")) URL.revokeObjectURL(prevUrl);
    // The demo plays a static /samples URL, not an uploaded blob — but a
    // previously uploaded video may still be in IndexedDB and would otherwise
    // resurrect on the next reload (Editor restores that blob when videoFile
    // is null, clobbering DEMO_VIDEO_URL with a stale upload). Bump the save
    // generation first so an in-flight save result for the old upload can't
    // report a stale failure against demo state, then queue the clear behind
    // it — enqueueVideoOp serializes, so the clear can't race a pending save.
    ++videoSaveGeneration;
    set((s) => ({
      project: {
        ...s.project,
        transcription: createDemoTranscription(),
        error: null,
        demoMode: true,
      },
      videoFile: null,
      videoUrl: DEMO_VIDEO_URL,
    }));
    if (typeof window !== "undefined") {
      enqueueStorageOp(clearVideoFromStorage).then((cleared) => {
        if (!cleared) {
          useEditorStore
            .getState()
            .setError(
              "Couldn't fully clear your previous video from local storage. If it reappears after a refresh, it's a browser-storage limitation."
            );
        }
      });
    }
  },

  applyChoreography: (bundle) =>
    set((s) => {
      const trans = s.project.transcription;
      if (!trans) return s;

      const emphasisIds = new Set(
        highlightEmphasisWords(
          trans.words.map((w) => ({ id: w.id, text: w.text })),
          bundle.emphasisWords || []
        )
      );

      const words = trans.words.map((w) => {
        if (!emphasisIds.has(w.id)) return w;
        return {
          ...w,
          animation: {
            ...w.animation,
            emphasis: {
              type: "scale" as const,
              scaleFrom: 100,
              scaleTo: 140,
              duration: 120,
              color: "#FFD700",
              glowRadius: 20,
            },
          },
        };
      });

      const ve = s.project.globalStyle.videoEffects;
      let sfx = s.project.globalStyle.sfx;
      let newVideoEffects = ve;
      let sfxEvents = s.project.composition.sfxEvents.filter(
        (e) => e.source !== "auto"
      );

      if (bundle.cameraMovement) {
        if (bundle.cameraMovement.enabled) {
          const emphasisArr = words
            .filter((w) => w.animation?.emphasis)
            .map((w) => w.id);
          const maxScale = fractionalIntensityToScale(bundle.cameraMovement.intensity);
          const events = buildCameraTimeline(trans.words, emphasisArr, {
            ...ve,
            maxScale,
          });
          newVideoEffects = { ...ve, maxScale, cameraEvents: events };
        } else {
          newVideoEffects = { ...ve, cameraEvents: [] };
        }
      }

      if (bundle.sfx) {
        sfx = { ...sfx, ...bundle.sfx };
      }

      // Rebuild auto SFX from the (possibly re-emphasized) words + settings.
      if (bundle.sfx?.enabled !== false || sfx.enabled) {
        const autoEvents = buildSfxTimeline(
          words,
          sfx,
          newVideoEffects.cameraEvents,
          s.project.composition.sfxOverrides ?? {}
        );
        sfxEvents = [
          ...sfxEvents.filter((e) => e.source !== "auto"),
          ...autoEvents,
        ];
      }

      return {
        project: {
          ...s.project,
          globalStyle: {
            ...s.project.globalStyle,
            ...bundle.global,
            sfx,
            videoEffects: newVideoEffects,
          },
          composition: { ...s.project.composition, sfxEvents },
          transcription: { ...trans, words },
        },
      };
    }),

  retimeWord: (wordId, start, end) =>
    set((s) => {
      if (!s.project.transcription) return s;
      const words = s.project.transcription.words.map((w) =>
        w.id === wordId ? { ...w, start, end } : w
      );
      const captionGroups = groupWordsIntoCaptions(
        words,
        s.project.globalStyle.maxWordsPerGroup
      );
      return {
        project: {
          ...s.project,
          transcription: {
            ...s.project.transcription,
            words,
            captionGroups,
          },
        },
      };
    }),

  regroupCaptions: () =>
    set((s) => {
      if (!s.project.transcription) return s;
      const captionGroups = groupWordsIntoCaptions(
        s.project.transcription.words,
        s.project.globalStyle.maxWordsPerGroup
      );
      return {
        project: {
          ...s.project,
          transcription: {
            ...s.project.transcription,
            captionGroups,
          },
        },
      };
    }),

  setMaxWordsPerGroup: (n) =>
    set((s) => {
      const globalStyle = { ...s.project.globalStyle, maxWordsPerGroup: n };
      let transcription = s.project.transcription;
      if (transcription) {
        const captionGroups = groupWordsIntoCaptions(
          transcription.words,
          n
        );
        transcription = { ...transcription, captionGroups };
      }
      return { project: { ...s.project, globalStyle, transcription } };
    }),

  applyPreset: (preset) =>
    set((s) => ({
      project: {
        ...s.project,
        globalStyle: { ...s.project.globalStyle, ...preset },
      },
    })),

  toggleCameraMovement: (enabled) =>
    set((s) => {
      const ve = s.project.globalStyle.videoEffects;
      if (enabled) {
        const trans = s.project.transcription;
        if (!trans) return s;
        const emphasisIds = trans.words
          .filter((w) => w.animation?.emphasis)
          .map((w) => w.id);
        // If no words are explicitly emphasized, drive the camera off every
        // word so the toggle has a visible effect instead of doing nothing.
        const ids = emphasisIds.length > 0 ? emphasisIds : trans.words.map((w) => w.id);
        const events = buildCameraTimeline(trans.words, ids, ve);
        return {
          project: {
            ...s.project,
            globalStyle: {
              ...s.project.globalStyle,
              videoEffects: { ...ve, cameraEvents: events },
            },
          },
        };
      }
      return {
        project: {
          ...s.project,
          globalStyle: {
            ...s.project.globalStyle,
            videoEffects: { ...ve, cameraEvents: [] },
          },
        },
      };
    }),

  setCameraIntensity: (intensity) =>
    set((s) => {
      const ve = s.project.globalStyle.videoEffects;
      const maxScale = sliderIntensityToScale(intensity);
      return {
        project: {
          ...s.project,
          globalStyle: {
            ...s.project.globalStyle,
            videoEffects: { ...ve, maxScale },
          },
        },
      };
    }),

  addManualCameraEvent: (wordId, intensity) =>
    set((s) => {
      const ve = s.project.globalStyle.videoEffects;
      const trans = s.project.transcription;
      if (!trans) return s;
      const word = trans.words.find((w) => w.id === wordId);
      if (!word) return s;
      const inSec = ve.inDuration / 1000;
      const outSec = ve.outDuration / 1000;
      const event = {
        id: uuid(),
        start: Math.max(0, word.start - 0.1),
        peak: word.start + Math.min(inSec, (word.end - word.start) * 0.4),
        end: word.end + outSec,
        type: "zoom" as const,
        intensity,
        source: "manual" as const,
      };
      const merged = mergeOverlapping([...ve.cameraEvents, event]);
      return {
        project: {
          ...s.project,
          globalStyle: {
            ...s.project.globalStyle,
            videoEffects: { ...ve, cameraEvents: merged },
          },
        },
      };
    }),

  setSfxEnabled: (enabled) =>
    set((s) => {
      if (!enabled) {
        return {
          project: {
            ...s.project,
            globalStyle: {
              ...s.project.globalStyle,
              sfx: { ...s.project.globalStyle.sfx, enabled: false },
            },
            composition: {
              ...s.project.composition,
              sfxEvents: s.project.composition.sfxEvents.filter(
                (e) => e.source !== "auto"
              ),
            },
          },
        };
      }
      const trans = s.project.transcription;
      if (!trans) return s;
      const sfx = { ...s.project.globalStyle.sfx, enabled: true };
      const ve = s.project.globalStyle.videoEffects;
      const overrides = s.project.composition.sfxOverrides ?? {};
      const autoEvents = buildSfxTimeline(trans.words, sfx, ve.cameraEvents, overrides);
      const manual = s.project.composition.sfxEvents.filter(
        (e) => e.source !== "auto"
      );
      return {
        project: {
          ...s.project,
          globalStyle: { ...s.project.globalStyle, sfx },
          composition: {
            ...s.project.composition,
            sfxEvents: [...manual, ...autoEvents],
          },
        },
      };
    }),

  setSfxDensity: (density) =>
    set((s) => {
      const sfx = { ...s.project.globalStyle.sfx, density };
      const autoEvents = s.project.transcription
        ? buildSfxTimeline(
            s.project.transcription.words,
            sfx,
            s.project.globalStyle.videoEffects.cameraEvents,
            s.project.composition.sfxOverrides ?? {}
          )
        : [];
      const manual = s.project.composition.sfxEvents.filter(
        (e) => e.source !== "auto"
      );
      return {
        project: {
          ...s.project,
          globalStyle: { ...s.project.globalStyle, sfx },
          composition: {
            ...s.project.composition,
            sfxEvents: [...manual, ...autoEvents],
          },
        },
      };
    }),

  setSfxVolume: (volume) =>
    set((s) => {
      const sfx = { ...s.project.globalStyle.sfx, volume };
      // Refresh the stored gain on every existing event so the Volume control
      // takes effect immediately instead of only after an event is rebuilt.
      const eventVolume =
        volume === "quiet" ? 0.5 : volume === "aggressive" ? 1 : 0.75;
      return {
        project: {
          ...s.project,
          globalStyle: { ...s.project.globalStyle, sfx },
          composition: {
            ...s.project.composition,
            sfxEvents: s.project.composition.sfxEvents.map((e) => ({
              ...e,
              volume: eventVolume,
            })),
          },
        },
      };
    }),

  setSfxOffsetMs: (offsetMs) =>
    set((s) => {
      const sfx = { ...s.project.globalStyle.sfx, offsetMs };
      const autoEvents = s.project.transcription
        ? buildSfxTimeline(
            s.project.transcription.words,
            sfx,
            s.project.globalStyle.videoEffects.cameraEvents,
            s.project.composition.sfxOverrides ?? {}
          )
        : [];
      const manual = s.project.composition.sfxEvents.filter(
        (e) => e.source !== "auto"
      );
      return {
        project: {
          ...s.project,
          globalStyle: { ...s.project.globalStyle, sfx },
          composition: {
            ...s.project.composition,
            sfxEvents: [...manual, ...autoEvents],
          },
        },
      };
    }),

  setSfxPack: (pack) =>
    set((s) => {
      const sfx = { ...s.project.globalStyle.sfx, pack };
      const autoEvents = s.project.transcription
        ? buildSfxTimeline(
            s.project.transcription.words,
            sfx,
            s.project.globalStyle.videoEffects.cameraEvents,
            s.project.composition.sfxOverrides ?? {}
          )
        : [];
      const manual = s.project.composition.sfxEvents.filter(
        (e) => e.source !== "auto"
      );
      return {
        project: {
          ...s.project,
          globalStyle: { ...s.project.globalStyle, sfx },
          composition: {
            ...s.project.composition,
            sfxEvents: [...manual, ...autoEvents],
          },
        },
      };
    }),

  regenerateSfx: () =>
    set((s) => {
      const trans = s.project.transcription;
      if (!trans) return s;
      const sfx = s.project.globalStyle.sfx;
      const autoEvents = buildSfxTimeline(
        trans.words,
        sfx,
        s.project.globalStyle.videoEffects.cameraEvents,
        s.project.composition.sfxOverrides ?? {}
      );
      const manual = s.project.composition.sfxEvents.filter(
        (e) => e.source !== "auto"
      );
      return {
        project: {
          ...s.project,
          composition: {
            ...s.project.composition,
            sfxEvents: [...manual, ...autoEvents],
          },
        },
      };
    }),

  setSfxOverride: (wordId, val) =>
    set((s) => {
      const trans = s.project.transcription;
      if (!trans) return s;
      const overrides = { ...(s.project.composition.sfxOverrides ?? {}) };
      if (val === "inherit") delete overrides[wordId];
      else overrides[wordId] = val;

      // A word is decided manually → drop any manual event scoped to it, and
      // regenerate auto so an overridden word never gets an automatic sound.
      const kept = s.project.composition.sfxEvents.filter(
        (e) => e.source !== "manual" || !(e.sourceWordIds ?? []).includes(wordId)
      );
      const sfx = s.project.globalStyle.sfx;
      const autoEvents =
        sfx.enabled && sfx.density !== "off" && trans
          ? buildSfxTimeline(
              trans.words,
              sfx,
              s.project.globalStyle.videoEffects.cameraEvents,
              overrides
            )
          : [];

      let sfxEvents = [...kept, ...autoEvents];

      if (val !== "inherit" && val !== "none") {
        const word = trans.words.find((w) => w.id === wordId);
        if (word) {
          sfxEvents = [
            ...sfxEvents,
            {
              id: uuid(),
              start: word.start + (sfx.offsetMs || 0) / 1000,
              duration: Math.max(0.08, word.end - word.start),
              role: "emphasis" as const,
              sound: val,
              volume:
                sfx.volume === "quiet" ? 0.5 : sfx.volume === "aggressive" ? 1 : 0.75,
              pitch: 1,
              offsetMs: sfx.offsetMs,
              source: "manual" as const,
              sourceWordIds: [word.id],
            },
          ];
        }
      }

      sfxEvents.sort((a, b) => a.start - b.start);

      return {
        project: {
          ...s.project,
          composition: { ...s.project.composition, sfxOverrides: overrides, sfxEvents },
        },
      };
    }),

  addManualSfxEvent: (wordId, sound) =>
    set((s) => {
      const trans = s.project.transcription;
      if (!trans) return s;
      const word = trans.words.find((w) => w.id === wordId);
      if (!word) return s;
      const sfx = s.project.globalStyle.sfx;
      const event = {
        id: uuid(),
        start: word.start + (sfx.offsetMs || 0) / 1000,
        duration: Math.max(0.08, word.end - word.start),
        role: "emphasis" as const,
        sound,
        volume: sfx.volume === "quiet" ? 0.5 : sfx.volume === "aggressive" ? 1 : 0.75,
        pitch: 1,
        offsetMs: sfx.offsetMs,
        source: "manual" as const,
        sourceWordIds: [word.id],
      };
      return {
        project: {
          ...s.project,
          composition: {
            ...s.project.composition,
            sfxEvents: [...s.project.composition.sfxEvents, event].sort(
              (a, b) => a.start - b.start
            ),
          },
        },
      };
    }),

  updateGroupLayout: (groupId, partial) =>
    set((s) => ({
      groupLayouts: {
        ...s.groupLayouts,
        [groupId]: { ...s.groupLayouts[groupId], ...partial },
      },
    })),

  resetGroupLayout: (groupId) =>
    set((s) => {
      const next = { ...s.groupLayouts };
      delete next[groupId];
      return { groupLayouts: next };
    }),

  undo: () => {
    commitPendingBaseline();
    const target = undoStack.pop();
    if (!target) return;
    redoStack.push(cloneDoc(useEditorStore.getState()));
    if (redoStack.length > HISTORY_LIMIT) redoStack.shift();
    suppressHistory = true;
    set((s) => ({
      project: {
        ...s.project,
        ...target.project,
        videoUrl: s.project.videoUrl,
        isTranscribing: false,
        error: null,
      },
      groupLayouts: target.groupLayouts,
      selectedWordIds: [],
      selectedCaptionGroupId: null,
    }));
    suppressHistory = false;
    pendingBaseline = null;
    pendingSince = 0;
    syncHistoryUI();
  },

  redo: () => {
    commitPendingBaseline();
    const target = redoStack.pop();
    if (!target) return;
    undoStack.push(cloneDoc(useEditorStore.getState()));
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    suppressHistory = true;
    set((s) => ({
      project: {
        ...s.project,
        ...target.project,
        videoUrl: s.project.videoUrl,
        isTranscribing: false,
        error: null,
      },
      groupLayouts: target.groupLayouts,
      selectedWordIds: [],
      selectedCaptionGroupId: null,
    }));
    suppressHistory = false;
    pendingBaseline = null;
    pendingSince = 0;
    syncHistoryUI();
  },

  restorePersisted: (data) => {
    suppressHistory = true;
    // Restoring over an in-session background orphans the current blob URL
    // (the image it points at is replaced wholesale) — revoke it up front,
    // mirroring newProject, so the browser can release the memory.
    const orphanedBgUrl = useEditorStore.getState().project.globalStyle.background.imageUrl;
    if (orphanedBgUrl && orphanedBgUrl.startsWith("blob:")) {
      URL.revokeObjectURL(orphanedBgUrl);
    }
    // A background image picked last session is stored as a blob: URL in the
    // JSON — but blob URLs are per-document and dead after reload. The live
    // bytes live in IndexedDB (see setBackgroundImageFile); here we only need
    // the safety net: drop the dead URL and the "image" mode, letting the
    // async restore fill the gap when the bytes actually exist.
    const restoredBackground = {
      ...defaultGlobalStyle.background,
      ...data.globalStyle.background,
    };
    if (
      typeof restoredBackground.imageUrl === "string" &&
      restoredBackground.imageUrl.startsWith("blob:")
    ) {
      restoredBackground.imageUrl = null;
      if (restoredBackground.mode === "image") restoredBackground.mode = "none";
    }
    set((s) => ({
      project: {
        ...s.project,
        transcription: data.transcription,
        // Deep-merge onto defaults so a project saved before a field existed
        // (e.g. backgroundColor, videoEffects) restores with the current
        // default instead of undefined — while keeping the user's saved
        // overrides on top.
        globalStyle: {
          ...defaultGlobalStyle,
          ...data.globalStyle,
          style: {
            ...defaultGlobalStyle.style,
            ...data.globalStyle.style,
          },
          motion: {
            ...defaultGlobalStyle.motion,
            ...data.globalStyle.motion,
            entrance: {
              ...defaultGlobalStyle.motion.entrance,
              ...data.globalStyle.motion?.entrance,
            },
            active: {
              ...defaultGlobalStyle.motion.active,
              ...data.globalStyle.motion?.active,
            },
            exit: {
              ...defaultGlobalStyle.motion.exit,
              ...data.globalStyle.motion?.exit,
            },
            emphasis: {
              ...defaultGlobalStyle.motion.emphasis,
              ...data.globalStyle.motion?.emphasis,
            },
          } as WordMotion,
          transform: {
            ...defaultGlobalStyle.transform,
            ...data.globalStyle.transform,
          },
          videoEffects: {
            ...defaultGlobalStyle.videoEffects,
            ...data.globalStyle.videoEffects,
          },
          sfx: {
            ...defaultGlobalStyle.sfx,
            ...data.globalStyle.sfx,
          },
          background: restoredBackground,
        },
        composition: {
          sfxEvents: data.composition?.sfxEvents ?? [],
          sfxOverrides: data.composition?.sfxOverrides ?? {},
        },
        speakerStyles: data.speakerStyles,
        speakerMotions: data.speakerMotions,
        dictionary: data.dictionary ?? [],
        demoMode: data.demoMode ?? false,
        isTranscribing: false,
        error: null,
      },
      groupLayouts: data.groupLayouts,
      currentTime: 0,
      selectedWordIds: [],
      selectedCaptionGroupId: null,
      isPlaying: false,
    }));
    suppressHistory = false;
    undoStack = [];
    redoStack = [];
    pendingBaseline = null;
    pendingSince = 0;
    syncHistoryUI();
  },

  newProject: () => {
    suppressHistory = true;
    ++videoSaveGeneration;
    // Bump the background save generation too: a pending image save from the
    // previous project would otherwise report its stale failure onto the new
    // (empty) project after this reset clears the store.
    ++backgroundImageSaveGeneration;
    set(() => {
      if (typeof window !== "undefined") {
        clearProjectFromStorage();
        enqueueStorageOp(clearVideoFromStorage).then((cleared) => {
          if (!cleared) {
            useEditorStore
              .getState()
              .setError(
                "Couldn't fully clear your previous video from local storage. If it reappears after a refresh, it's a browser-storage limitation."
              );
          }
        });
        // The background image can't resurrect on its own (a leftover blob
        // needs saved mode "image" + a persisted URL to matter, and this clear
        // wipes the localStorage project too), so no user warning here.
        enqueueStorageOp(clearBackgroundImageFromStorage);
      }
      const prevUrl = useEditorStore.getState().videoUrl;
      if (prevUrl && prevUrl.startsWith("blob:")) URL.revokeObjectURL(prevUrl);
      const prevBgUrl = useEditorStore.getState().project.globalStyle.background.imageUrl;
      if (prevBgUrl && prevBgUrl.startsWith("blob:")) URL.revokeObjectURL(prevBgUrl);
      return {
        project: {
          id: uuid(),
          name: "Untitled Project",
          videoUrl: "",
          transcription: null,
          globalStyle: { ...defaultGlobalStyle },
          composition: { sfxEvents: [], sfxOverrides: {} },
          speakerStyles: {},
          speakerMotions: {},
          dictionary: [],
          isTranscribing: false,
          error: null,
          demoMode: false,
        },
        groupLayouts: {},
        currentTime: 0,
        selectedWordIds: [],
        selectedCaptionGroupId: null,
        videoFile: null,
        videoUrl: null,
        isPlaying: false,
      };
    });
    suppressHistory = false;
    undoStack = [];
    redoStack = [];
    pendingBaseline = null;
    pendingSince = 0;
    syncHistoryUI();
  },
}));

let persistTimer: ReturnType<typeof setTimeout> | null = null;
if (typeof window !== "undefined") {
  useEditorStore.subscribe((state, prev) => {
    if (
      state.project === prev.project &&
      state.groupLayouts === prev.groupLayouts
    ) {
      return;
    }
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const s = useEditorStore.getState();
      saveProjectToStorage({
        transcription: s.project.transcription,
        globalStyle: s.project.globalStyle,
        composition: s.project.composition,
        speakerStyles: s.project.speakerStyles,
        speakerMotions: s.project.speakerMotions,
        dictionary: s.project.dictionary,
        groupLayouts: s.groupLayouts,
        demoMode: s.project.demoMode,
      });
    }, 300);
  });

  // Undo/redo capture: record the document state *before* every documentable
  // change, coalescing rapid successive changes (a slider drag, a marquee
  // selection edit, SFX regen) into one undo step via a 500ms gesture window.
  useEditorStore.subscribe((state, prev) => {
    if (suppressHistory) return;
    if (!docChanged(state, prev)) return;
    const now = Date.now();
    if (!pendingBaseline || now - pendingSince > COALESCE_MS) {
      // Start (or restart after the window lapsed) a new coalescing window:
      // the current document becomes the baseline and the window deadline is
      // set to now. Any intervening state is rolled back on undo.
      commitPendingBaseline();
      pendingBaseline = cloneDoc(prev);
      pendingSince = now;
      redoStack = [];
      syncHistoryUI();
    } else {
      // Continuation of the same gesture — slide the deadline forward so a
      // drag/gesture longer than COALESCE_MS stays one undo step instead of
      // committing an intermediate baseline and splitting the undo.
      pendingSince = now;
    }
  });
}
