import { ImageSegmenter, FilesetResolver } from "@mediapipe/tasks-vision";

// Lazy-loaded singleton — the WASM runtime + model weights only download once
// a user actually picks a background mode, not on every editor load.
let segmenterPromise: Promise<ImageSegmenter> | null = null;

// Must match the installed @mediapipe/tasks-vision version — FilesetResolver
// derives the exact WASM filenames (vision_wasm_internal.* etc.) from the base
// URL, and those change between releases.
const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

// Uncached — each call creates a fresh ImageSegmenter instance. VIDEO running
// mode is stateful and assumes one continuous frame stream; callers that need
// to segment a *different* video than the live editor preview (e.g. export,
// which runs against its own detached <video> element while the live preview
// may still be ticking) must not share the singleton below, or frames from
// both streams interleave through one instance with undefined results.
export function createSegmenter(): Promise<ImageSegmenter> {
  return FilesetResolver.forVisionTasks(WASM_BASE_URL).then((vision) =>
    ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_ASSET_PATH,
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    })
  );
}

export function loadSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    // A failed (rejected) load must not be cached forever, or every later
    // mode switch would resurface the stale rejection instead of retrying —
    // clear the slot before rethrowing so the next call starts fresh.
    segmenterPromise = createSegmenter().catch((err) => {
      segmenterPromise = null;
      throw err;
    });
  }
  return segmenterPromise;
}

// VIDEO running mode requires strictly increasing timestamps on every call.
// rAF can fire fast enough that two consecutive performance.now() reads are
// equal (or, with reduced timer precision in some browsers, even go
// backwards) — MediaPipe throws on that, which showed up live as a
// console-error crash during playback. Force monotonicity here rather than
// trusting the caller's clock.
let lastTimestampMs = -1;
function nextTimestamp(requested: number): number {
  const ts = Math.max(requested, lastTimestampMs + 1);
  lastTimestampMs = ts;
  return ts;
}

// selfie_segmenter (the ImageSegmenter build, float16) emits a SINGLE
// confidence channel, and channel 0 IS the person: verified live on a portrait
// frame (mean ~0.94 on the subject, ~0.0 on the background). Keep it
// un-inverted — a previous "invert on read" attempt put the backdrop on the
// subject, the opposite of what this repo's convention needs (1 = person).
// (The two-channel background/person ordering is the *older* selfie
// segmentation solution, not this ImageSegmenter model build.)
let warnedFrameNotReady = false;
export function segmentFrame(
  segmenter: ImageSegmenter,
  video: HTMLVideoElement,
  timestampMs: number
): { mask: Float32Array; width: number; height: number } | null {
  // VIDEO running mode needs a decoded frame at the current playhead.
  // segmentForVideo throws synchronously when the video isn't there yet —
  // right after enabling a mode (frame not decoded during play-start / at
  // t=0) or mid-scrub before the browser hands back the target frame. Guard
  // with HAVE_CURRENT_DATA and swallow the remaining throws so a not-ready
  // frame degrades to "skip this tick" (the rAF loop retries once the frame
  // lands) instead of crashing the editor with an error overlay.
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  let result: { mask: Float32Array; width: number; height: number } | null = null;
  try {
    segmenter.segmentForVideo(video, nextTimestamp(timestampMs), (res) => {
      const confidence = res.confidenceMasks?.[0];
      if (!confidence) return;
      const mask = new Float32Array(confidence.getAsFloat32Array());
      result = { mask, width: confidence.width, height: confidence.height };
      confidence.close();
    });
  } catch (err) {
    if (!warnedFrameNotReady) {
      warnedFrameNotReady = true;
      console.warn(
        "Segmenter frame not ready — skipping until the video has a decoded frame.",
        err
      );
    }
  }
  return result;
}
