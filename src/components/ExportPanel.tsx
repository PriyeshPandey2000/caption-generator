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
      const music = state.project.globalStyle.music;
      const musicOn = !!music.url;

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
      // Keep a rolling buffer of ffmpeg's stderr so the audio-presence probe
      // below can read the input stream dump back (bound so a long encode's
      // logs can't grow memory without limit).
      const ffmpegLogs: string[] = [];

      ffmpeg.on("log", ({ message }) => {
        console.log("[ffmpeg]", message);
        ffmpegLogs.push(message);
        if (ffmpegLogs.length > 4000) ffmpegLogs.shift();
      });

      ffmpeg.on("progress", ({ progress }) => {
        setProgress(`Encoding: ${Math.round(progress * 100)}%`);
      });

      setProgress("Initializing encoder...");
      await ffmpeg.load();

      setProgress("Loading video...");
      await ffmpeg.writeFile("input.mp4", await fetchFile(videoUrl));

      // Build the SFX mix: one audio input per event, delayed/scaled/pitched to
      // its video-time slot, then amixed with the video's own audio. Consumes the
      // same SfxEvent data as the live engine — no audio capture.
      const sfxInputs: string[] = [];
      const sfxChains: string[] = [];
      if (sfxOn) {
        setProgress("Loading sound effects...");
        const files = new Set(sfxEvents.map((e) => e.sound));
        // ffmpeg inputs are ordered: 0 = styled stage, 1 = source video, and
        // each SFX file after that. Chains must reference the SFX inputs from 2
        // on — starting at 1 would collide with the source video's [1:a] used
        // by [main] below and leave the SFX inputs unreferenced.
        let idx = 2;
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
      const cropToPlatform = state.previewPlatform !== "none";

      // Effective output width/height: the fixed 1280 cap (or native), then
      // the platform crop applied to whichever dimension it affects — same
      // branch logic as the preview crop, so the hidden canvas we render the
      // styled captions into matches the frame the user designed on.
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

      // Render every frame exactly as the editor previews it — styled,
      // animated, positioned captions + camera zoom — into an MP4 via
      // WebCodecs (with a MediaRecorder WebM fallback where H.264 encode
      // isn't available).
      setProgress("Compositing captions...");
      const { renderStyledVideo } = await import("@/core/export-renderer");
      const styled = await renderStyledVideo({
        videoUrl,
        outW,
        outH,
        duration: meta.duration,
        transcription: state.project.transcription as NonNullable<typeof transcription>,
        globalStyle: state.project.globalStyle,
        speakerStyles: state.project.speakerStyles,
        groupLayouts: state.groupLayouts,
        previewPlatform: state.previewPlatform,
        onProgress: (fraction, message) => {
          setProgress(`${message} …`);
          if (fraction >= 1) console.log("[styled-export] done");
        },
      });
      await ffmpeg.writeFile(styled.stage, new Uint8Array(await styled.blob.arrayBuffer()));

      // Background music goes in as the LAST ffmpeg input (after the SFX
      // inputs at 2..N), looped to cover the whole clip. Its gain is applied
      // here so preview and export stay in the same ballpark.
      if (musicOn) {
        setProgress("Loading music track...");
        await ffmpeg.writeFile("music_input", await fetchFile(music.url as string));
      }

      // Find out whether the source clip has its own audio: it's the duck key
      // for the music bed, and the SFX mix currently keys off it too. Probe the
      // very input.mp4 that feeds the filtergraph with ffmpeg itself — a
      // decodeAudioData presence check can reject on container/codec combos
      // where ffmpeg finds audio, silently dropping the source voice from the
      // mix. Opening the file with a zero-length output prints the input
      // stream dump ("Stream #N:_: Audio:") without decoding the clip.
      ffmpegLogs.length = 0;
      await ffmpeg.exec(["-i", "input.mp4", "-t", "0", "-f", "null", "-"]);
      const voice = ffmpegLogs.some((m) =>
        /stream\s*#\d+:\d+.*:\s*audio:/i.test(m)
      );
      ffmpegLogs.length = 0;
      const musIdx = 2 + sfxEvents.length;
      const musGain = musicOn ? music.volume : 0;
      const musChain = `[${musIdx}:a]aformat=channel_layouts=stereo,volume=${musGain.toFixed(3)}`;
      const duck = voice && musicOn && music.duckEnabled;

      // Compose the audio filtergraph:
      //  - each SFX is delayed/scaled/pitched into its video-time slot,
      //  - the music bed is ducked under the source voice with a sidechain
      //    compressor (attack/release tuned so dips are smooth, not gated),
      //  - everything is amixed, ending no longer than the styled video.
      // A silent source skips the voice entirely so [1:a] is never referenced.
      let audioFilter: string | null = null;
      if (sfxOn) {
        const parts: string[] = [];
        // Voice is consumed twice (duck key + final mix) only when ducking is
        // on, so split it up front then — ffmpeg can't reuse one output label
        // for two consumers.
        if (voice) {
          parts.push(
            duck
              ? "[1:a]aformat=channel_layouts=stereo,asplit=2[vKey][vMix]"
              : "[1:a]aformat=channel_layouts=stereo[vMix]"
          );
        }
        parts.push(...sfxChains);
        if (musicOn) parts.push(`${musChain}[music]`);
        if (duck) {
          parts.push(
            "[music][vKey]sidechaincompress=threshold=0.04:ratio=9:attack=25:release=350:makeup=1[duck]"
          );
        }
        const mixLabels = sfxChains.map((_, i) => `[fx${i + 2}]`).join("");
        let inputs = voice ? "[vMix]" : "";
        if (mixLabels) inputs += mixLabels;
        if (duck) inputs += "[duck]";
        else if (musicOn) inputs += "[music]";
        const count = (voice ? 1 : 0) + sfxEvents.length + (musicOn ? 1 : 0);
        audioFilter =
          parts.join(";") +
          ";" +
          inputs +
          `amix=inputs=${count}:duration=longest:normalize=0,apad,atrim=duration=${meta.duration.toFixed(3)}[aout]`;
      } else if (musicOn) {
        if (duck) {
          audioFilter = `${musChain}[music];[1:a]aformat=channel_layouts=stereo,asplit=2[vKey][vMix];[music][vKey]sidechaincompress=threshold=0.04:ratio=9:attack=25:release=350:makeup=1[duck];[vMix][duck]amix=inputs=2:duration=longest:normalize=0,apad,atrim=duration=${meta.duration.toFixed(3)}[aout]`;
        } else if (voice) {
          // Bed at constant gain mixed under the source voice (no ducking).
          audioFilter = `${musChain}[music];[1:a]aformat=channel_layouts=stereo[vMix];[vMix][music]amix=inputs=2:duration=longest:normalize=0,apad,atrim=duration=${meta.duration.toFixed(3)}[aout]`;
        } else {
          // No source voice and no ducking: the bed plays straight at its gain.
          audioFilter = `${musChain},apad,atrim=duration=${meta.duration.toFixed(3)}[aout]`;
        }
      }

      const args = [
        "-i", styled.stage,
        "-i", "input.mp4",
        ...sfxInputs,
      ];
      if (musicOn) args.push("-stream_loop", "-1", "-t", String(meta.duration), "-i", "music_input");
      args.push("-map", "0:v");
      if (audioFilter) {
        args.push("-filter_complex", audioFilter, "-map", "[aout]");
      } else {
        // Keep the source's audio track when neither SFX nor music use a filter
        // (optional map so a silent source doesn't abort the export).
        args.push("-map", "1:a?");
      }
      args.push(
        ...(styled.usedFallback
          ? [
              "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "2500k", "-maxrate", "3000k", "-bufsize", "6000k",
              // MediaRecorder stamps webm frames with wall-clock capture time,
              // so a slow paint loop silently lengthens the video and drifts it
              // from the (real-time) source audio. Retime every frame onto the
              // synthetic 30fps grid (same fps as the styled renderer).
              "-vf", "setpts=N/(30*TB)",
            ]
          : ["-c:v", "copy"]),
        "-c:a", "aac",
        "-b:a", "128k",
        // Bound output to the styled video length (also stops a stream_loop'd
        // music bed from running past the end of the clip).
        "-shortest",
        "output.mp4"
      );

      setProgress(
        sfxOn && musicOn
          ? "Mixing music, sounds & finalizing..."
          : sfxOn
            ? "Mixing sounds & finalizing..."
            : musicOn
              ? "Mixing music & finalizing..."
              : "Finalizing..."
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
