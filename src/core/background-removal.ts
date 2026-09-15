import { ImageSegmenter, FilesetResolver } from "@mediapipe/tasks-vision";

// Lazy-loaded singleton — the WASM runtime + model weights only download once
// a user actually picks a background mode, not on every editor load.
let segmenterPromise: Promise<ImageSegmenter> | null = null;

const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

export function loadSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = FilesetResolver.forVisionTasks(WASM_BASE_URL).then(
      (vision) =>
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

// The single-class selfie segmenter's confidenceMasks[0] — trying it
// un-inverted first: the previous "invert on read" guess had the effect
// landing on the subject instead of the background, the opposite of what
// this repo's convention needs (1 = person). Verify visually after this
// change; flip back if the cutout is still backwards.
export function segmentFrame(
  segmenter: ImageSegmenter,
  video: HTMLVideoElement,
  timestampMs: number
): { mask: Float32Array; width: number; height: number } | null {
  let result: { mask: Float32Array; width: number; height: number } | null = null;
  segmenter.segmentForVideo(video, nextTimestamp(timestampMs), (res) => {
    const confidence = res.confidenceMasks?.[0];
    if (!confidence) return;
    const mask = new Float32Array(confidence.getAsFloat32Array());
    result = { mask, width: confidence.width, height: confidence.height };
    confidence.close();
  });
  return result;
}
