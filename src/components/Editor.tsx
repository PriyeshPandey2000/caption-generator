"use client";

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  Group,
  Panel as ResizablePanel,
  Separator,
  usePanelRef,
} from "react-resizable-panels";
import { useEditorStore } from "@/store/editor-store";
import { parseSegmentsToWords, groupWordsIntoCaptions } from "@/core/captions";
import {
  loadProjectFromStorage,
  clearProjectFromStorage,
  loadVideoFromStorage,
} from "@/core/persistence";
import UploadZone from "@/components/UploadZone";
import VideoPreview from "@/components/VideoPreview";
import Timeline from "@/components/Timeline";
import TranscriptPanel from "@/components/TranscriptPanel";
import Inspector from "@/components/Inspector";
import Presets from "@/components/Presets";
import ExportPanel from "@/components/ExportPanel";
import TransportControls from "@/components/TransportControls";
import Link from "next/link";
import ApiKeyInput from "@/components/ApiKeyInput";
import CaptionOverlay from "@/components/CaptionOverlay";
import PlatformPreviewOverlay, { PlatformPreviewToggle } from "@/components/PlatformPreviewOverlay";
import { useDemoPlayback } from "@/hooks/useDemoPlayback";
import { TranscriptionResult } from "@/core/types";

type Panel = "inspector" | "presets" | null;

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      resolve(video.duration);
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video duration"));
    };
    video.src = url;
  });
}

export default function Editor() {
  const [apiKey, setApiKey] = useState<string>(
    typeof window !== "undefined"
      ? localStorage.getItem("groq_api_key") || ""
      : ""
  );
  const [activePanel, setActivePanel] = useState<Panel>("inspector");
  const [showTranscript, setShowTranscript] = useState(true);
  const [showStylePanel, setShowStylePanel] = useState(true);

  const videoUrl = useEditorStore((s) => s.videoUrl);
  const setVideoFile = useEditorStore((s) => s.setVideoFile);
  const transcription = useEditorStore((s) => s.project.transcription);
  const isTranscribing = useEditorStore((s) => s.project.isTranscribing);
  const error = useEditorStore((s) => s.project.error);
  const setTranscription = useEditorStore((s) => s.setTranscription);
  const setIsTranscribing = useEditorStore((s) => s.setIsTranscribing);
  const setError = useEditorStore((s) => s.setError);
  const globalStyle = useEditorStore((s) => s.project.globalStyle);
  const loadDemo = useEditorStore((s) => s.loadDemo);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setPlaybackRate = useEditorStore((s) => s.setPlaybackRate);
  const restorePersisted = useEditorStore((s) => s.restorePersisted);
  const [demoFrameRatio, setDemoFrameRatio] = useState(1);
  const demoSurfaceRef = useRef<HTMLDivElement>(null);
  const previewPlatform = useEditorStore((s) => s.previewPlatform);
  const setPreviewPlatform = useEditorStore((s) => s.setPreviewPlatform);
  const newProject = useEditorStore((s) => s.newProject);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);

  const isDemoMode = !!transcription && !videoUrl;
  useDemoPlayback(isDemoMode);

  useEffect(() => {
    const saved = loadProjectFromStorage();
    if (saved && saved.transcription) {
      restorePersisted(saved);
    }
    // Capture the generation this restore belongs to. If the user starts a New
    // Project (newProject swaps in a fresh project.id) while the IndexedDB read
    // below is still pending, the restoring of a stale blob must be ignored.
    const loadProjectId = useEditorStore.getState().project.id;
    // Restore the uploaded video from IndexedDB so the preview survives a
    // page refresh (object URLs do not persist across reloads).
    let cancelled = false;
    loadVideoFromStorage().then((video) => {
      if (cancelled) return;
      // The read finished but the user already moved to a new project —
      // never restore a stale blob onto it.
      if (useEditorStore.getState().project.id !== loadProjectId) return;
      // A user selection made while this read was pending wins over the
      // persisted blob.
      if (useEditorStore.getState().videoFile) return;
      if (video && video.blob) {
        const file = new File([video.blob], video.name || "video", {
          type: video.type || video.blob.type || "video/mp4",
        });
        const url = URL.createObjectURL(file);
        useEditorStore.getState().setRestoredVideo(file, url);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measure the empty-state demo surface so its fallback captions scale with
  // the 9:16 platform frame the same way the real preview does.
  useEffect(() => {
    const el = demoSurfaceRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const portraitW = Math.min(rect.height * (9 / 16), rect.width);
      setDemoFrameRatio(portraitW / rect.width);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isDemoMode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const isTyping =
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable;
      if (isTyping) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }

      if (e.code === "Space") {
        if (isDemoMode) {
          e.preventDefault();
          setIsPlaying(!isPlaying);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const state = useEditorStore.getState();
        for (const id of state.selectedWordIds) {
          state.resetWordStyle(id);
          state.resetWordMotion(id);
        }
        if (state.selectedWordIds.length > 0) e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDemoMode, isPlaying, setIsPlaying, undo, redo]);

  const handleFileSelect = useCallback(
    async (file: File) => {
      setVideoFile(file);

      setIsTranscribing(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("apiKey", apiKey);

        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Transcription failed");
        }

        const data = await res.json();
        const { words, parsedSegments } = parseSegmentsToWords(data.segments || []);
        const captionGroups = groupWordsIntoCaptions(
          words,
          globalStyle.maxWordsPerGroup
        );

        // Groq's reported duration can drift from the actual video length
        // (e.g. silent tails, container quirks). Anchor the timeline to the
        // real duration so captions and scrubbing line up with playback.
        let duration = data.duration || 0;
        try {
          const real = await getVideoDuration(file);
          // video.duration is Infinity for container-less recordings (e.g.
          // MediaRecorder WebM); never let that poison the timeline.
          if (Number.isFinite(real) && real > 0) duration = real;
        } catch {
          // fall back to the API-reported duration
        }

        const result: TranscriptionResult = {
          language: data.language || "en",
          duration,
          segments: parsedSegments,
          words,
          captionGroups,
        };

        setTranscription(result);
        setIsTranscribing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Transcription failed");
        setIsTranscribing(false);
      }
    },
    [
      apiKey,
      setVideoFile,
      setTranscription,
      setIsTranscribing,
      setError,
      globalStyle.maxWordsPerGroup,
    ]
  );

  return (
    <div className="flex flex-col h-screen bg-zinc-900 text-white">
      <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-display text-lg font-bold tracking-tight">
            Caption
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(120deg,#00FF66,#22C55E)",
              }}
            >
              Lab
            </span>
          </Link>
          {transcription && (
            <span className="text-xs text-zinc-500">
              {transcription.words.length} words
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Groq key now comes from the server env var (GROQ_API_KEY) —
              no need to expose a key field to end users. */}
          {/* <ApiKeyInput onKeySet={setApiKey} /> */}
          <ExportPanel />
          <div className="flex items-center gap-1">
            <button
              onClick={undo}
              disabled={!canUndo}
              title="Undo last change (⌘Z / Ctrl+Z)"
              className="h-7 px-2.5 text-xs rounded-lg border border-white/15 transition-colors disabled:opacity-35 disabled:pointer-events-none bg-transparent text-white hover:bg-white/10 flex items-center justify-center"
            >
              ↺ Undo
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title="Redo (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)"
              className="h-7 px-2.5 text-xs rounded-lg border border-white/15 transition-colors disabled:opacity-35 disabled:pointer-events-none bg-transparent text-white hover:bg-white/10 flex items-center justify-center"
            >
              ↻ Redo
            </button>
          </div>
          <button
            onClick={() => {
              clearProjectFromStorage();
              newProject();
            }}
            title="Start over — clears the saved project"
            className="h-7 px-3 text-white bg-transparent border border-white/15 text-xs rounded-lg hover:bg-white/10 transition-colors flex items-center justify-center"
          >
            New Project
          </button>
        </div>
      </header>

      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <Group orientation="horizontal" className="flex-1 min-w-0 overflow-hidden">
        <ResizablePanel
          id="editor-main"
          minSize="30"
          defaultSize="58"
          className="min-w-0 flex flex-col"
        >
          <div className="flex flex-col min-w-0 h-full">
            <div className="flex-1 p-4 overflow-hidden">
            {!transcription ? (
              <div className="relative h-full flex flex-col items-center justify-center gap-6 px-4">
                <div className="text-center max-w-2xl">
                  <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
                    Turn{" "}
                    <span
                      className="bg-clip-text text-transparent"
                      style={{
                        backgroundImage:
                          "linear-gradient(120deg,#00FF66,#22C55E)",
                      }}
                    >
                      speech
                    </span>{" "}
                    into{" "}
                    <span
                      className="bg-clip-text text-transparent"
                      style={{
                        backgroundImage:
                          "linear-gradient(120deg,#00FF66,#22C55E)",
                      }}
                    >
                      animated typography
                    </span>
                  </h2>
                  <p className="text-sm text-zinc-300 mt-2">
                    Every aspect customisable — precision | scale | word level.
                    But you never have to customise anything.
                  </p>
                  <div className="mt-5 w-full max-w-xl">
                    <div className="grid grid-cols-2 gap-2">
                      <FeatureCard icon="upload" label="Upload → styled captions in seconds" />
                      <FeatureCard icon="drag" label="Drag & scale — “make it big type”" />
                      <FeatureCard icon="sparkle" label="AI choreography in plain English" />
                      <FeatureCard icon="export" label="Export MP4 / SRT / VTT — all in-browser" />
                    </div>
                  </div>
                </div>
                <div className="w-full max-w-2xl">
                  <UploadZone onFileSelect={handleFileSelect} onDemo={loadDemo} />
                </div>

                {isTranscribing && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center rounded-lg z-20"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <div aria-hidden="true" className="w-8 h-8 border-2 border-[#00FF66] border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-zinc-200">Transcribing your video…</p>
                      <p className="text-xs text-zinc-500">
                        This can take a moment for longer clips
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative w-full h-full">
                {videoUrl ? (
                  <VideoPreview />
                ) : (
                  <div className="w-full h-full flex flex-col gap-2">
                    <div
                      ref={demoSurfaceRef}
                      className="relative flex-1 min-h-0 bg-zinc-950 rounded-lg overflow-hidden flex items-center justify-center"
                    >
                      <div
                        className={`relative h-full bg-black overflow-hidden flex items-center justify-center ${
                          previewPlatform !== "none" ? "aspect-[9/16] max-w-full ring-1 ring-white/15" : "w-full"
                        }`}
                      >
                        <CaptionOverlay scaleFactor={previewPlatform !== "none" ? demoFrameRatio : 1} />
                        <PlatformPreviewOverlay platform={previewPlatform} />
                      </div>
                      <PlatformPreviewToggle
                        value={previewPlatform}
                        onChange={setPreviewPlatform}
                        className="absolute top-2 right-2 z-20"
                      />
                      <div className="absolute bottom-3 left-4 text-[11px] text-zinc-500 pointer-events-none">
                        Space = play · drag a caption to move · drag the corner to scale · Del = reset style
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      <TransportControls
                        duration={transcription?.duration || 0}
                        onPlayPause={(r) => {
                          setPlaybackRate(r);
                          setIsPlaying(!isPlaying);
                        }}
                        onSeek={setCurrentTime}
                      />
                      <button
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = ".mp4,.webm,.ogg,.mov,.avi,.mkv,audio/*,video/*";
                          input.onchange = (e) => {
                            const f = (e.target as HTMLInputElement).files?.[0];
                            if (!f) return;
                            if (window.confirm("This will replace the sample captions with your own video — continue?")) {
                              handleFileSelect(f);
                            }
                          };
                          input.click();
                        }}
                        className="px-3 py-1.5 bg-black/70 text-white text-sm rounded-lg hover:bg-black/90 transition-colors"
                      >
                        Drop a video
                      </button>
                    </div>
                  </div>
                )}
                {isTranscribing && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-[#00FF66] border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-zinc-300">Transcribing...</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {transcription && <Timeline />}
          </div>
          </ResizablePanel>

        {transcription && (
          <ResizableSidebar
            panelId="editor-transcript"
            label="Transcript"
            open={showTranscript}
            onOpenChange={setShowTranscript}
          >
            <TranscriptPanel onClose={() => setShowTranscript(false)} />
          </ResizableSidebar>
        )}

        {transcription && (
          <ResizableSidebar
            panelId="editor-style"
            label="Style"
            open={showStylePanel}
            onOpenChange={setShowStylePanel}
          >
            <div className="w-full min-w-0 h-full flex flex-col border-l border-zinc-800 bg-zinc-900 overflow-hidden">
              <div className="flex items-center border-b border-zinc-800 shrink-0">
                <button
                  onClick={() => setActivePanel("inspector")}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                    activePanel === "inspector"
                      ? "text-[#00FF66] border-b-2 border-[#00FF66]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Style
                </button>
                <button
                  onClick={() => setActivePanel("presets")}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                    activePanel === "presets"
                      ? "text-[#00FF66] border-b-2 border-[#00FF66]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Presets
                </button>
                <button
                  onClick={() => setShowStylePanel(false)}
                  title="Hide panel"
                  className="px-2 text-zinc-500 hover:text-white shrink-0"
                >
                  ✕
                </button>
              </div>
              {activePanel === "inspector" && <Inspector />}
              {activePanel === "presets" && <Presets />}
            </div>
          </ResizableSidebar>
        )}
      </Group>
    </div>
  );
}

const FEATURE_ICONS: Record<string, string> = {
  upload: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12",
  drag: "M7 16V4m0 0L3 8m4-4l4 4m6 8v-4m0 0l4 4m-4-4l-4 4M4 20h16",
  sparkle: "M12 3v4m0 10v4m-9-9h4m10 0h4M6.34 6.34l2.83 2.83m5.66 5.66l2.83 2.83M6.34 17.66l2.83-2.83m5.66-5.66l2.83-2.83",
  export: "M12 4v12m0 0l-4-4m4 4l4-4M4 20h16",
};

function FeatureCard({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 transition-colors hover:border-[#00ff66]/25 hover:bg-white/[0.05]">
      <div className="shrink-0 w-7 h-7 rounded-lg bg-[#00ff66]/10 flex items-center justify-center">
        <svg className="w-3.5 h-3.5 text-[#00ff66]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={FEATURE_ICONS[icon]} />
        </svg>
      </div>
      <span className="text-xs text-zinc-300 leading-tight">{label}</span>
    </div>
  );
}

function CollapsedSidebarTab({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`Show ${label} panel`}
      className="w-7 h-full shrink-0 flex flex-col items-center justify-center gap-2 border-l border-zinc-800 bg-zinc-800 hover:bg-zinc-700 transition-colors"
    >
      <span className="text-zinc-400 text-xs">◀</span>
      <span
        className="text-[10px] text-zinc-400 font-medium tracking-wide"
        style={{ writingMode: "vertical-rl" }}
      >
        {label}
      </span>
    </button>
  );
}

// One resizable sidebar: a drag strip (Separator) next to a Panel that can be
// collapsed to zero width. Collapse happens either via a header ✕ (calls
// `onOpenChange(false)`) or by the user dragging the separator below the panel's
// minSize; the collapsed state is mirrored up through `onOpenChange` so the
// parent can swap the strip for the vertical "show panel" tab.
function ResizableSidebar({
  panelId,
  label,
  open,
  onOpenChange,
  children,
  defaultSize = "22",
  minSize = "14",
  maxSize = "40",
}: {
  panelId: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  defaultSize?: string;
  minSize?: string;
  maxSize?: string;
}) {
  const panelRef = usePanelRef();
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // The Panel's size is uncontrolled, so respond to `open` imperatively:
  // collapse on ✕, expand on a tab click. Deferred to the next frame because
  // on a fresh mount (e.g. this sidebar appearing for the first time when a
  // transcript loads), react-resizable-panels hasn't finished registering
  // this panel's constraints with its PanelGroup yet — calling isCollapsed()
  // synchronously in the same commit throws "Panel constraints not found."
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const raf = requestAnimationFrame(() => {
      if (!open && !panel.isCollapsed()) panel.collapse();
      else if (open && panel.isCollapsed()) panel.expand();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, panelRef]);

  // A user drag-righting the separator below minSize collapses the panel on
  // its own — mirror that back so the open/closed state stays in sync.
  const handleResize = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const collapsed = panel.isCollapsed();
    if (collapsed !== !openRef.current) onOpenChange(!collapsed);
  }, [onOpenChange, panelRef]);

  return (
    <>
      <Separator className="group relative flex items-center justify-center shrink-0 px-0.5 py-0 hover:bg-zinc-800/40 active:bg-zinc-800/70 transition-colors">
        {open ? (
          <svg
            viewBox="0 0 12 24"
            width="10"
            height="18"
            fill="currentColor"
            aria-hidden="true"
            className="text-zinc-600 group-hover:text-[#00FF66] group-hover:drop-shadow-[0_0_3px_rgba(0,255,102,0.6)] transition-colors shrink-0"
          >
            <circle cx="3" cy="4" r="1.4" />
            <circle cx="9" cy="4" r="1.4" />
            <circle cx="3" cy="12" r="1.4" />
            <circle cx="9" cy="12" r="1.4" />
            <circle cx="3" cy="20" r="1.4" />
            <circle cx="9" cy="20" r="1.4" />
          </svg>
        ) : (
          <CollapsedSidebarTab label={label} onClick={() => onOpenChange(true)} />
        )}
      </Separator>
      <ResizablePanel
        id={panelId}
        collapsible
        collapsedSize="0"
        defaultSize={defaultSize}
        minSize={minSize}
        maxSize={maxSize}
        panelRef={panelRef}
        onResize={handleResize}
        className="min-w-0 h-full overflow-hidden"
      >
        {children}
      </ResizablePanel>
    </>
  );
}
