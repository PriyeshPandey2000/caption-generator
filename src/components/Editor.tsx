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
          <h1 className="text-lg font-bold">
            Caption<span className="text-blue-500">Lab</span>
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
            className="px-3 py-1.5 bg-zinc-800 text-zinc-300 text-sm rounded-lg hover:bg-zinc-700 transition-colors"
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
              <div className="relative h-full flex flex-col items-center justify-center gap-5 px-4">
                <div className="text-center max-w-xl">
                  <h2 className="text-2xl font-bold text-white">
                    Turn speech into{" "}
                    <span className="text-blue-500">animated typography</span>
                  </h2>
                  <p className="text-sm text-zinc-400 mt-2">
                    Every aspect customisable — precision | scale | word level.
                    But you never have to customise anything.
                  </p>
                  <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-zinc-500 text-left">
                    <li>· Upload → styled captions in seconds</li>
                    <li>· Drag &amp; scale — “make it big type”</li>
                    <li>· AI choreography in plain English</li>
                    <li>· Export MP4 / SRT / VTT — all in-browser</li>
                  </ul>
                </div>
                <div className="w-full max-w-2xl">
                  <UploadZone onFileSelect={handleFileSelect} />
                </div>
                <div className="flex items-center gap-4 text-xs text-zinc-500">
                  <span className="bg-zinc-800 px-3 py-1.5 rounded-full">or</span>
                  <button
                    onClick={loadDemo}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors font-medium"
                  >
                    Try it with sample captions →
                  </button>
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
