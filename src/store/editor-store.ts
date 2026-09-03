import { create } from "zustand";
import {
  Project,
  WordStyle,
  WordMotion,
  WordTransform,
  GlobalStyle,
  TranscriptionResult,
} from "@/core/types";
import { defaultGlobalStyle } from "@/core/styles";
import { groupWordsIntoCaptions } from "@/core/captions";
import { createDemoTranscription } from "@/core/demo";
import { ChoreographyBundle, highlightEmphasisWords } from "@/core/choreography";
import { saveProjectToStorage } from "@/core/persistence";
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
  selectedWordIds: string[];
  selectedCaptionGroupId: string | null;
  videoFile: File | null;
  videoUrl: string | null;

  setVideoFile: (file: File) => void;
  setTranscription: (result: TranscriptionResult) => void;
  setIsTranscribing: (v: boolean) => void;
  setError: (error: string | null) => void;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (v: boolean) => void;
  selectWord: (id: string, multi?: boolean) => void;
  selectCaptionGroup: (id: string | null) => void;
  clearSelection: () => void;

  updateWordStyle: (wordId: string, style: Partial<WordStyle>) => void;
  updateWordMotion: (wordId: string, motion: Partial<WordMotion>) => void;
  updateWordTransform: (wordId: string, transform: Partial<WordTransform>) => void;
  updateGlobalStyle: (style: Partial<GlobalStyle>) => void;
  updateSpeakerStyle: (speaker: string, style: Partial<WordStyle>) => void;
  updateSpeakerMotion: (speaker: string, motion: Partial<WordMotion>) => void;
  resetWordStyle: (wordId: string) => void;
  resetWordMotion: (wordId: string) => void;
  loadDemo: () => void;
  applyChoreography: (bundle: ChoreographyBundle) => void;
  groupLayouts: Record<string, GroupLayout>;
  updateGroupLayout: (groupId: string, partial: Partial<GroupLayout>) => void;
  resetGroupLayout: (groupId: string) => void;

  retimeWord: (wordId: string, start: number, end: number) => void;
  regroupCaptions: () => void;
  setMaxWordsPerGroup: (n: number) => void;
  applyPreset: (preset: Partial<GlobalStyle>) => void;
  restorePersisted: (data: {
    transcription: TranscriptionResult | null;
    globalStyle: GlobalStyle;
    speakerStyles: Record<string, Partial<WordStyle>>;
    speakerMotions: Record<string, Partial<WordMotion>>;
    groupLayouts: Record<string, GroupLayout>;
  }) => void;
  newProject: () => void;
}

const initialState: Project = {
  id: uuid(),
  name: "Untitled Project",
  videoUrl: "",
  transcription: null,
  globalStyle: { ...defaultGlobalStyle },
  speakerStyles: {},
  speakerMotions: {},
  isTranscribing: false,
  error: null,
};

export const useEditorStore = create<EditorState>((set) => ({
  project: initialState,
  currentTime: 0,
  isPlaying: false,
  selectedWordIds: [],
  selectedCaptionGroupId: null,
  videoFile: null,
  videoUrl: null,
  groupLayouts: {},

  setVideoFile: (file) => {
    const url = URL.createObjectURL(file);
    set({ videoFile: file, videoUrl: url });
  },

  setTranscription: (result) => {
    set((s) => ({
      project: {
        ...s.project,
        transcription: result,
        isTranscribing: false,
        error: null,
      },
    }));
  },

  setIsTranscribing: (v) =>
    set((s) => ({ project: { ...s.project, isTranscribing: v } })),

  setError: (error) =>
    set((s) => ({ project: { ...s.project, error } })),

  setCurrentTime: (t) => set({ currentTime: t }),

  setIsPlaying: (v) => set({ isPlaying: v }),

  selectWord: (id, multi = false) =>
    set((s) => ({
      selectedWordIds: multi
        ? s.selectedWordIds.includes(id)
          ? s.selectedWordIds.filter((wid) => wid !== id)
          : [...s.selectedWordIds, id]
        : [id],
      selectedCaptionGroupId: null,
    })),

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

  updateGlobalStyle: (style) =>
    set((s) => ({
      project: {
        ...s.project,
        globalStyle: { ...s.project.globalStyle, ...style },
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

  loadDemo: () =>
    set((s) => ({
      project: {
        ...s.project,
        transcription: createDemoTranscription(),
        error: null,
      },
    })),

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

      return {
        project: {
          ...s.project,
          globalStyle: { ...s.project.globalStyle, ...bundle.global },
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

  restorePersisted: (data) =>
    set((s) => ({
      project: {
        ...s.project,
        transcription: data.transcription,
        globalStyle: data.globalStyle,
        speakerStyles: data.speakerStyles,
        speakerMotions: data.speakerMotions,
        isTranscribing: false,
        error: null,
      },
      groupLayouts: data.groupLayouts,
      currentTime: 0,
      selectedWordIds: [],
      selectedCaptionGroupId: null,
      isPlaying: false,
    })),

  newProject: () =>
    set(() => ({
      project: {
        id: uuid(),
        name: "Untitled Project",
        videoUrl: "",
        transcription: null,
        globalStyle: { ...defaultGlobalStyle },
        speakerStyles: {},
        speakerMotions: {},
        isTranscribing: false,
        error: null,
      },
      groupLayouts: {},
      currentTime: 0,
      selectedWordIds: [],
      selectedCaptionGroupId: null,
      isPlaying: false,
    })),
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
        speakerStyles: s.project.speakerStyles,
        speakerMotions: s.project.speakerMotions,
        groupLayouts: s.groupLayouts,
      });
    }, 300);
  });
}
