"use client";

import { useState, useCallback, useEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import { parseSegmentsToWords, groupWordsIntoCaptions } from "@/core/captions";
import { loadProjectFromStorage, clearProjectFromStorage } from "@/core/persistence";
import UploadZone from "@/components/UploadZone";
import VideoPreview from "@/components/VideoPreview";
import Timeline from "@/components/Timeline";
import Inspector from "@/components/Inspector";
import Presets from "@/components/Presets";
import ExportPanel from "@/components/ExportPanel";
import ApiKeyInput from "@/components/ApiKeyInput";
import CaptionOverlay from "@/components/CaptionOverlay";
import { useDemoPlayback } from "@/hooks/useDemoPlayback";
import { TranscriptionResult } from "@/core/types";

type Panel = "inspector" | "presets" | null;

export default function Editor() {
  const [apiKey, setApiKey] = useState<string>(
    typeof window !== "undefined"
      ? localStorage.getItem("groq_api_key") || ""
      : ""
  );
  const [activePanel, setActivePanel] = useState<Panel>("inspector");

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
  const restorePersisted = useEditorStore((s) => s.restorePersisted);
  const newProject = useEditorStore((s) => s.newProject);

  const isDemoMode = !!transcription && !videoUrl;
  useDemoPlayback(isDemoMode);

  useEffect(() => {
    const saved = loadProjectFromStorage();
    if (saved && saved.transcription) {
      restorePersisted(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const isTyping =
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable;
      if (isTyping) return;

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
  }, [isDemoMode, isPlaying, setIsPlaying]);

  const handleFileSelect = useCallback(
    async (file: File) => {
      setVideoFile(file);
      if (!apiKey) {
        setError("Enter your Groq API key to transcribe");
        return;
      }

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

        const result: TranscriptionResult = {
          language: data.language || "en",
          duration: data.duration || 0,
          segments: parsedSegments,
          words,
          captionGroups,
        };

        setTranscription(result);
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
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-lg font-bold tracking-tight">
            Caption
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(120deg,#00FF66,#22C55E)",
              }}
            >
              Lab
            </span>
          </h1>
          {transcription && (
            <span className="text-xs text-zinc-500">
              {transcription.words.length} words ·{" "}
              {transcription.captionGroups.length} groups
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ApiKeyInput onKeySet={setApiKey} />
          <ExportPanel />
          <button
            onClick={() => {
              clearProjectFromStorage();
              newProject();
            }}
            title="Start over — clears the saved project"
            className="px-3 py-1.5 text-white bg-transparent border border-white/15 text-sm rounded-lg hover:bg-white/10 transition-colors"
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

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col">
          <div className="flex-1 p-4 overflow-hidden">
            {!transcription ? (
              <div
                className="relative h-full flex flex-col items-center justify-center gap-6 px-4"
                style={{
                  background:
                    "radial-gradient(circle at 50% 28%, rgba(0,255,102,0.10), transparent 55%)",
                }}
              >
                <div className="text-center max-w-xl">
                  <h2 className="font-display text-3xl font-extrabold tracking-tight text-white">
                    Turn{" "}
                    <span className="hero-word mx-1.5" style={{ animationDelay: "0s" }}>
                      speech
                    </span>{" "}
                    into{" "}
                    <span
                      className="bg-clip-text text-transparent"
                      style={{
                        backgroundImage:
                          "linear-gradient(120deg,#00FF66,#22C55E)",
                        filter:
                          "drop-shadow(0 0 18px rgba(0,255,102,0.35))",
                      }}
                    >
                      animated typography
                    </span>
                  </h2>
                  <p className="text-sm text-zinc-300 mt-2">
                    Every aspect customisable — precision | scale | word level.
                    But you never have to customise anything.
                  </p>
                  <div className="mt-5 grid grid-cols-2 gap-3 text-left">
                    <FeatureCard icon="upload" label="Upload → styled captions in seconds" />
                    <FeatureCard icon="drag" label="Drag & scale — “make it big type”" />
                    <FeatureCard icon="sparkle" label="AI choreography in plain English" />
                    <FeatureCard icon="export" label="Export MP4 / SRT / VTT — all in-browser" />
                  </div>
                </div>
                <div className="w-full max-w-2xl">
                  <UploadZone onFileSelect={handleFileSelect} onDemo={loadDemo} />
                </div>
              </div>
            ) : (
              <div className="relative w-full h-full">
                {videoUrl ? (
                  <VideoPreview />
                ) : (
                  <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
                    <div className="relative w-full h-full flex items-center justify-center">
                      <CaptionOverlay />
                      <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
                        <button
                          onClick={() => setIsPlaying(!isPlaying)}
                          className="px-3 py-1.5 bg-black/70 text-white text-sm rounded-lg hover:bg-black/90 transition-colors flex items-center gap-1.5"
                        >
                          {isPlaying ? (
                            <>
                              <span className="text-[10px]">⏸</span> Pause
                            </>
                          ) : (
                            <>
                              <span className="text-[10px]">▶</span> Play
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            const input = document.createElement("input");
                            input.type = "file";
                            input.accept = "video/*";
                            input.onchange = (e) => {
                              const f = (e.target as HTMLInputElement).files?.[0];
                              if (f) handleFileSelect(f);
                            };
                            input.click();
                          }}
                          className="px-3 py-1.5 bg-black/70 text-white text-sm rounded-lg hover:bg-black/90 transition-colors"
                        >
                          Drop a video
                        </button>
                      </div>
                      <div className="absolute bottom-3 left-4 text-[11px] text-zinc-500">
                        Space = play · drag a caption to move · drag the corner to scale · Del = reset style
                      </div>
                    </div>
                  </div>
                )}
                {isTranscribing && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-zinc-300">Transcribing...</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {transcription && <Timeline />}
        </div>

        {transcription && (
          <>
            {activePanel === "inspector" && <Inspector />}
            {activePanel === "presets" && <Presets />}
          </>
        )}
      </div>

      {transcription && (
        <div className="flex border-t border-zinc-800 bg-zinc-900">
          <button
            onClick={() => setActivePanel("inspector")}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              activePanel === "inspector"
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Inspector
          </button>
          <button
            onClick={() => setActivePanel("presets")}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              activePanel === "presets"
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Presets
          </button>
        </div>
      )}
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
