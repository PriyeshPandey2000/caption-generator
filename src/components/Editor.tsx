"use client";

import { useState, useCallback } from "react";
import { useEditorStore } from "@/store/editor-store";
import { parseSegmentsToWords, groupWordsIntoCaptions } from "@/core/captions";
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

  const isDemoMode = !!transcription && !videoUrl;
  useDemoPlayback(isDemoMode);

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
              <div className="relative flex flex-col items-center justify-center h-full gap-4">
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
