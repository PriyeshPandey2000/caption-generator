"use client";

import { useState, useCallback, useRef, useEffect } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

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

      const cropToPlatform = useEditorStore.getState().previewPlatform !== "none";
      // Center-crop to the active platform's 9:16 feed frame so the exported
      // file matches what the preview's `object-cover` 9:16 box shows. Crop
      // whichever dimension the source over-provides relative to 9:16: trim
      // width for sources wider than 9:16 (the common case), trim height for
      // sources already narrower/taller than 9:16 (e.g. a 720x1600 capture) —
      // an ffmpeg `if()` expression picks the branch since the source aspect
      // ratio isn't known until runtime. Always-keep-height was a bug: it
      // left narrower-than-9:16 sources completely uncropped.
      const cropFilter = cropToPlatform
        ? `crop=w='if(gt(iw/ih,9/16),trunc(ih*9/16/2)*2,iw)':h='if(gt(iw/ih,9/16),ih,trunc(iw*16/9/2)*2)':x='(iw-ow)/2':y='(ih-oh)/2',`
        : "";

      // Effective output width/height: the fixed 1280 cap (or native), then
      // the platform crop applied to whichever dimension it affects — same
      // branch logic as the ffmpeg filter above, so fontPx (libass output
      // pixels) matches the frame the caption actually renders into.
      let outW = needsScale ? Math.min(MAX_EXPORT_WIDTH, meta.width) : meta.width;
      let outH = needsScale
        ? Math.round((meta.height * outW) / meta.width / 2) * 2
        : meta.height;
      if (cropToPlatform) {
        if (outW / outH > 9 / 16) {
          outW = Math.floor((outH * 9) / 32) * 2;
        } else {
          outH = Math.floor((outW * 8) / 9) * 2;
        }
      }
      const fontPx = Math.max(10, Math.min(48, Math.round(24 * (outW / MAX_EXPORT_WIDTH))))

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
        "-vf", `${scaleFilter}${cropFilter}subtitles=captions.srt:force_style='FontSize=${fontPx},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'`,
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

      setProgress(
        sfxOn
          ? cropToPlatform
            ? "Cropping 9:16, mixing sounds & burning captions..."
            : "Mixing sounds & burning captions..."
          : cropToPlatform
            ? "Cropping 9:16 & burning captions..."
            : "Burning in captions..."
      );
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
    <div className="relative flex items-center" ref={menuRef}>
      <button
        onClick={exportMP4}
        disabled={!transcription || isExporting}
        className="h-7 px-3 text-xs bg-[#00FF66] text-black font-semibold rounded-l-lg hover:bg-[#22C55E] disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
        title="Export MP4 (burn in captions)"
      >
        {isExporting ? progress || "Exporting..." : "Export"}
      </button>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        disabled={!transcription || isExporting}
        title="More export formats"
        className="h-7 px-2 text-xs bg-[#00FF66] text-black font-semibold rounded-r-lg border-l border-black/20 hover:bg-[#22C55E] disabled:opacity-40 transition-colors flex items-center justify-center"
      >
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 min-w-[160px] rounded-lg bg-zinc-700 border border-zinc-600 shadow-2xl overflow-hidden z-30">
          <button
            onClick={() => {
              setMenuOpen(false);
              exportMP4();
            }}
            className="w-full text-left px-3 py-2 text-xs text-white hover:bg-zinc-600 transition-colors flex items-center gap-2"
          >
            Export MP4
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              exportSRT();
            }}
            className="w-full text-left px-3 py-2 text-xs text-white hover:bg-zinc-600 transition-colors flex items-center gap-2"
          >
            Export SRT
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              exportVTT();
            }}
            className="w-full text-left px-3 py-2 text-xs text-white hover:bg-zinc-600 transition-colors flex items-center gap-2"
          >
            Export VTT
          </button>
        </div>
      )}
    </div>
  );
}
