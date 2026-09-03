"use client";

import { useState, useCallback } from "react";
import { useEditorStore } from "@/store/editor-store";
import { wordsToSRT } from "@/core/captions";

const MAX_EXPORT_DURATION_SEC = 90;
const MAX_EXPORT_WIDTH = 1280;

function getVideoMetadata(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      video.src = "";
    };
    video.onerror = () => reject(new Error("Could not read video metadata"));
    video.src = url;
  });
}

export default function ExportPanel() {
  const transcription = useEditorStore((s) => s.project.transcription);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState("");

  const exportSRT = useCallback(() => {
    if (!transcription) return;
    const srt = wordsToSRT(transcription.words);
    const blob = new Blob([srt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "captions.srt";
    a.click();
    URL.revokeObjectURL(url);
  }, [transcription]);

  const exportVTT = useCallback(() => {
    if (!transcription) return;
    const srt = wordsToSRT(transcription.words);
    const vtt = "WEBVTT\n\n" + srt.replace(/,/g, ".");
    const blob = new Blob([vtt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "captions.vtt";
    a.click();
    URL.revokeObjectURL(url);
  }, [transcription]);

  const exportMP4 = useCallback(async () => {
    if (!transcription) return;
    setIsExporting(true);
    setProgress("Loading ffmpeg.wasm...");

    try {
      const videoUrl = useEditorStore.getState().videoUrl;
      if (!videoUrl) throw new Error("No video loaded");

      setProgress("Checking video...");
      const meta = await getVideoMetadata(videoUrl);
      if (meta.duration > MAX_EXPORT_DURATION_SEC) {
        setProgress(
          `Error: video is ${Math.round(meta.duration)}s — browser export caps at ${MAX_EXPORT_DURATION_SEC}s`
        );
        return;
      }

      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile } = await import("@ffmpeg/util");

      const ffmpeg = new FFmpeg();

      ffmpeg.on("log", ({ message }) => {
        console.log("[ffmpeg]", message);
      });

      ffmpeg.on("progress", ({ progress }) => {
        setProgress(`Encoding: ${Math.round(progress * 100)}%`);
      });

      setProgress("Initializing encoder...");
      await ffmpeg.load();

      setProgress("Loading video...");
      await ffmpeg.writeFile("input.mp4", await fetchFile(videoUrl));

      const srtContent = wordsToSRT(transcription.words);
      await ffmpeg.writeFile("captions.srt", new TextEncoder().encode(srtContent));

      const needsScale = meta.width > MAX_EXPORT_WIDTH;
      const scaleFilter = needsScale ? `scale='min(${MAX_EXPORT_WIDTH},iw)':-2,` : "";

      setProgress("Burning in captions...");
      await ffmpeg.exec([
        "-i", "input.mp4",
        "-t", String(MAX_EXPORT_DURATION_SEC),
        "-vf", `${scaleFilter}subtitles=captions.srt:force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'`,
        "-preset", "ultrafast",
        "-b:v", "2500k",
        "-maxrate", "3000k",
        "-bufsize", "6000k",
        "-c:a", "aac",
        "-b:a", "128k",
        "output.mp4",
      ]);

      setProgress("Downloading...");
      const data = (await ffmpeg.readFile("output.mp4")) as Uint8Array;
      const blob = new Blob([new Uint8Array(data)], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "captioned-video.mp4";
      a.click();
      URL.revokeObjectURL(url);

      setProgress("Done!");
    } catch (err) {
      setProgress(`Error: ${err}`);
    } finally {
      setTimeout(() => {
        setIsExporting(false);
        setProgress("");
      }, 2000);
    }
  }, [transcription]);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={exportSRT}
        disabled={!transcription}
        className="px-3 py-1.5 text-xs text-white bg-transparent border border-white/15 rounded-lg hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
      >
        SRT
      </button>
      <button
        onClick={exportVTT}
        disabled={!transcription}
        className="px-3 py-1.5 text-xs text-white bg-transparent border border-white/15 rounded-lg hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
      >
        VTT
      </button>
      <button
        onClick={exportMP4}
        disabled={!transcription || isExporting}
        className="px-3 py-1.5 text-xs bg-[#00FF66] text-black font-semibold rounded-lg hover:bg-[#22C55E] disabled:opacity-40 transition-colors"
      >
        {isExporting ? progress || "Exporting..." : "Export MP4"}
      </button>
    </div>
  );
}
