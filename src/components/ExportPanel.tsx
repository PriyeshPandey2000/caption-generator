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
      const state = useEditorStore.getState();
      const videoUrl = state.videoUrl;
      if (!videoUrl) throw new Error("No video loaded");

      const sfxEvents = state.project.composition.sfxEvents ?? [];
      const sfxOn = !!state.project.globalStyle.sfx?.enabled && sfxEvents.length > 0;

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

      // Build the SFX mix: one audio input per event, delayed/scaled/pitched to
      // its video-time slot, then amixed with the video's own audio. Consumes the
      // same SfxEvent data as the live engine — no audio capture.
      const sfxInputs: string[] = [];
      const sfxChains: string[] = [];
      if (sfxOn) {
        setProgress("Loading sound effects...");
        const files = new Set(sfxEvents.map((e) => e.sound));
        let idx = 1;
        for (const sound of files) {
          await ffmpeg.writeFile(`sfx_${sound}.mp3`, await fetchFile(`/sfx/${sound}.mp3`));
        }
        for (const ev of sfxEvents) {
          const startMs = Math.round(ev.start * 1000);
          const vol = ev.volume ?? 0.75;
          const pitch = ev.pitch ?? 1;
          const chain = `[${idx}:a]volume=${vol.toFixed(3)}${
            pitch !== 1 ? `,asetrate=44100*${pitch.toFixed(4)},aresample=44100` : ""
          },adelay=${startMs}|${startMs},aformat=channel_layouts=stereo[fx${idx}]`;
          sfxInputs.push("-i", `sfx_${ev.sound}.mp3`);
          sfxChains.push(chain);
          idx++;
        }
      }

      const needsScale = meta.width > MAX_EXPORT_WIDTH;
      const scaleFilter = needsScale ? `scale='min(${MAX_EXPORT_WIDTH},iw)':-2,` : "";

      // Compose the audio filtergraph: delay/scale/pitch each SFX into its
      // video-time slot, then amix them over the video's own stereo audio.
      let audioFilter: string | null = null;
      if (sfxOn) {
        const preMix = sfxChains.join(";");
        const mixLabels = sfxChains.map((_, i) => `[fx${i + 1}]`).join("");
        audioFilter = `[0:a]aformat=channel_layouts=stereo[main];${preMix};[main]${mixLabels}amix=inputs=${sfxEvents.length + 1}:duration=first:normalize=0[aout]`;
      }

      const args = [
        "-i", "input.mp4",
        ...sfxInputs,
        "-t", String(MAX_EXPORT_DURATION_SEC),
        "-vf", `${scaleFilter}subtitles=captions.srt:force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'`,
      ];
      if (audioFilter) {
        args.push("-filter_complex", audioFilter, "-map", "0:v", "-map", "[aout]");
      }
      args.push(
        "-preset", "ultrafast",
        "-b:v", "2500k",
        "-maxrate", "3000k",
        "-bufsize", "6000k",
        "-c:a", "aac",
        "-b:a", "128k",
        "output.mp4"
      );

      setProgress(sfxOn ? "Mixing sounds & burning captions..." : "Burning in captions...");
      await ffmpeg.exec(args);

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
