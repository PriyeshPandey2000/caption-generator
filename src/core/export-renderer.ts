import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { paintExportFrame, VideoFrameSource } from "./scene-renderer";
import { createBackgroundCompositor, BackgroundCompositor } from "./background-composite";
import { GlobalStyle, PreviewPlatform, TranscriptionResult, WordStyle } from "./types";

const MAX_EXPORT_DURATION_SEC = 90;
const DEFAULT_BITRATE = 5_000_000;

// High profile level 4.0 → Main 4.0 → Baseline 3.1, in order of quality.
// Level must accommodate the export resolution; falling back keeps H.264
// encode available even where high-profile 1080p isn't.
const AVC_CODEC_CANDIDATES = ["avc1.640028", "avc1.4d0028", "avc1.42001f"];

export interface StyledRenderOptions {
  videoUrl: string;
  outW: number;
  outH: number;
  duration: number;
  transcription: TranscriptionResult;
  globalStyle: GlobalStyle;
  speakerStyles: Record<string, Partial<WordStyle>>;
  groupLayouts: Record<string, { x: number; y: number; scale: number }>;
  previewPlatform: PreviewPlatform;
  frameRate?: number;
  bitrate?: number;
  onProgress?: (fraction: number, message: string) => void;
  signal?: AbortSignal;
}

export interface StyledRenderResult {
  blob: Blob;
  mimeType: string;
  /** True when WebCodecs/Muxer wasn't available and MediaRecorder was used. */
  usedFallback: boolean;
  /** Filename to write into the ffmpeg virtual FS. */
  stage: "styled.mp4" | "styled.webm";
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function seekVideoTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const onSeeked = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("seekerror", onSeekError);
      resolve();
    };
    const onSeekError = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("seekerror", onSeekError);
      reject(new Error("Video seek failed"));
    };
    const target = Math.min(Math.max(0, t), video.duration || t);
    // Don't resolve optimistically on timeout — painting a frame the video
    // hasn't actually decoded to would encode a stale frame into the export.
    // Fail loudly instead.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("seekerror", onSeekError);
      reject(new Error(`Video seek to ${target.toFixed(3)}s timed out`));
    }, 1500);
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("seekerror", onSeekError, { once: true });
    video.currentTime = target;
  });
}

async function loadVideo(videoUrl: string): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoUrl;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not load video for styled render"));
  });
  // Seek to a nonzero time to force the first frame decode — a detached
  // <video> never composites on its own, so requestVideoFrameCallback can
  // hang forever; the decoded seek frame is guaranteed drawable by canvas.
  await seekVideoTo(video, 0.001);
  return video;
}

async function pickAvcCodec(
  width: number,
  height: number,
  framerate: number,
  bitrate: number
): Promise<string | null> {
  if (
    typeof VideoEncoder === "undefined" ||
    typeof VideoEncoder.isConfigSupported !== "function"
  ) {
    return null;
  }
  for (const codec of AVC_CODEC_CANDIDATES) {
    try {
      const res = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate,
      });
      if (res.supported) return codec;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Renders every frame deterministically into a canvas, then the text of the
 * video following it is encoded H.264 (WebCodecs → mp4-muxer) or recorded via
 * MediaRecorder (WebM) when WebCodecs is unavailable. The video is seeked to
 * each synthetic time so captions and camera zoom are sampled from the same
 * clock the loop drives. */
export async function renderStyledVideo(
  opts: StyledRenderOptions
): Promise<StyledRenderResult> {
  aborted(opts.signal);

  const fps = opts.frameRate ?? 30;
  const bitrate = opts.bitrate ?? DEFAULT_BITRATE;
  const video = await loadVideo(opts.videoUrl);
  const duration = Math.min(
    opts.duration,
    Number.isFinite(video.duration) ? video.duration : opts.duration,
    MAX_EXPORT_DURATION_SEC
  );

  // The caption font is a next/font web font; ensure it is loaded before any
  // measureText/draw, or canvas falls back to a different family.
  try {
    if (document.fonts?.ready) await document.fonts.ready;
  } catch {
    // Fonts not available headless — fall back to the family stack.
  }

  const canvas = document.createElement("canvas");
  canvas.width = opts.outW;
  canvas.height = opts.outH;

  const totalFrames = Math.max(1, Math.round(duration * fps));

  // Own compositor per export run (never the live-preview's segmenter
  // singleton — see createSegmenter's docs in background-removal.ts). Only
  // loaded when a background mode is actually selected, since it downloads
  // the segmentation model.
  const compositor =
    opts.globalStyle.background.mode !== "none" ? await createBackgroundCompositor() : null;

  try {
    const codec = await pickAvcCodec(opts.outW, opts.outH, fps, bitrate);
    if (codec && typeof VideoFrame !== "undefined") {
      return await renderWithWebCodecs(
        opts,
        video,
        canvas,
        codec,
        fps,
        bitrate,
        duration,
        totalFrames,
        compositor
      );
    }
    return await renderWithMediaRecorder(opts, video, canvas, fps, duration, totalFrames, compositor);
  } finally {
    compositor?.dispose();
  }
}

async function paintFrame(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  t: number,
  opts: StyledRenderOptions,
  compositor: BackgroundCompositor | null
) {
  let source: VideoFrameSource = video;
  if (compositor) {
    const composited = await compositor.renderFrame(
      video,
      opts.globalStyle.background,
      Math.round(t * 1000)
    );
    if (composited) {
      source = composited;
    } else {
      // A null composite usually means the frame had not finished decoding
      // the instant a seek landed (videoWidth/videoHeight still 0). Encoding
      // the raw video here would flash the unprocessed frame into the export,
      // so retry briefly before failing the export loudly.
      let recovered = false;
      for (let attempt = 0; attempt < 5 && !recovered; attempt++) {
        await sleep(50);
        const retried = await compositor.renderFrame(
          video,
          opts.globalStyle.background,
          Math.round(t * 1000)
        );
        if (retried) {
          source = retried;
          recovered = true;
        }
      }
      if (!recovered) {
        throw new Error(
          `Background compositing failed at ${t.toFixed(3)}s — video frame never became ready`
        );
      }
    }
  }
  paintExportFrame(canvas, {
    transcription: opts.transcription,
    globalStyle: opts.globalStyle,
    speakerStyles: opts.speakerStyles,
    groupLayouts: opts.groupLayouts,
    video: source,
    currentTime: t,
    outW: opts.outW,
    outH: opts.outH,
    previewPlatform: opts.previewPlatform,
  });
}

async function renderWithWebCodecs(
  opts: StyledRenderOptions,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  codec: string,
  fps: number,
  bitrate: number,
  duration: number,
  totalFrames: number,
  compositor: BackgroundCompositor | null
): Promise<StyledRenderResult> {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: opts.outW, height: opts.outH, frameRate: fps },
    fastStart: "in-memory",
  });

  // VideoEncoder.error fires asynchronously; a throw there becomes an uncaught
  // callback exception. Store it and surface it from the main loop / flush.
  let encodeErr: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta ?? undefined);
    },
    error: (err) => {
      encodeErr = err;
    },
  });
  encoder.configure({
    codec,
    width: opts.outW,
    height: opts.outH,
    bitrate,
    framerate: fps,
  });

  const throwEncodeError = () => {
    if (encodeErr) {
      throw new Error(
        `VideoEncoder failed: ${encodeErr instanceof Error ? encodeErr.message : String(encodeErr)}`
      );
    }
  };

  const lastSafeT = Math.max(0, duration - 1 / 1_000_000);

  try {
    for (let i = 0; i < totalFrames; i++) {
      aborted(opts.signal);
      throwEncodeError();
      const t = Math.min(i / fps, lastSafeT);
      await seekVideoTo(video, t);
      await paintFrame(canvas, video, t, opts, compositor);

      const timestamp = Math.round(t * 1_000_000);
      let frame: VideoFrame;
      try {
        frame = new VideoFrame(canvas, { timestamp });
      } catch {
        const bitmap = await createImageBitmap(canvas);
        frame = new VideoFrame(bitmap, { timestamp });
        bitmap.close();
      }
      encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 3)) === 0 });
      frame.close();

      opts.onProgress?.((i + 1) / totalFrames, `Rendering frame ${i + 1}/${totalFrames}`);
      // Let the encode queue drain and the UI stay responsive.
      if (i % 10 === 0) await sleep(0);
    }

    await encoder.flush();
    throwEncodeError();
  } finally {
    try {
      encoder.close();
    } catch {
      // Already closed.
    }
  }

  muxer.finalize();
  const buffer = muxer.target.buffer;
  const blob = new Blob([buffer], { type: "video/mp4" });
  return { blob, mimeType: "video/mp4", usedFallback: false, stage: "styled.mp4" };
}

async function renderWithMediaRecorder(
  opts: StyledRenderOptions,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  fps: number,
  duration: number,
  totalFrames: number,
  compositor: BackgroundCompositor | null
): Promise<StyledRenderResult> {
  const mimeCandidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

  // captureStream(0) + track.requestFrame() gives us one exact frame per paint
  // (instead of `fps`-capped sampling on an internal timer); the ffmpeg pass
  // retimes those frames with setpts=N/(fps*TB) so the webm duration equals the
  // caption timeline regardless of how slow painting runs.
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(500);

  try {
    // MediaRecorder samples the canvas on its own timer, so drawing must be
    // paced to real time or every frame collapses into t=0.
    const start = performance.now();
    for (let i = 0; i < totalFrames; i++) {
      aborted(opts.signal);
      const deadline = start + (i / fps) * 1000;
      const now = performance.now();
      if (deadline > now) await sleep(deadline - now);
      const t = Math.min(i / fps, Math.max(0, duration - 1 / 1_000_000));
      await seekVideoTo(video, t);
      await paintFrame(canvas, video, t, opts, compositor);
      track.requestFrame();
      opts.onProgress?.((i + 1) / totalFrames, `Capturing frame ${i + 1}/${totalFrames}`);
      if (i % 5 === 0) await sleep(0);
    }
    // Let trailing frames make it into the recorder before stopping.
    await sleep(400);
  } finally {
    recorder.stop();
  }

  await stopped;
  stream.getTracks().forEach((t) => t.stop());

  const blob = new Blob(chunks, { type: mimeType || "video/webm" });
  return { blob, mimeType: blob.type, usedFallback: true, stage: "styled.webm" };
}