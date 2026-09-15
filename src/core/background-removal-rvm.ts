import * as ort from "onnxruntime-web";

export type RvmBackend = "webgpu" | "wasm";

export interface RvmStats {
  backend: RvmBackend | null;
  loaded: boolean;
  loadMs: number;
  frames: number;
  totalMs: number;
  lastMs: number;
  minMs: number;
  maxMs: number;
  reset(): void;
}

export interface RvmSegmenter {
  backend: RvmBackend;
  session: ort.InferenceSession;
  states: ort.Tensor[];
  reset(): void;
  dispose(): void;
}

const MODEL_URL = "/models/rvm_mobilenetv3_fp32.onnx";
const WASM_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
const WEBGPU_TIMEOUT_MS = 10000;
const PROBE_TIMEOUT_MS = 8000;
const DOWNSAMPLE_RATIO = 0.25;
const INPUT_LONG_SIDE = 960;

const INPUT_NAMES = ["src", "r1i", "r2i", "r3i", "r4i", "downsample_ratio"];
const OUTPUT_NAMES = ["fgr", "pha", "r1o", "r2o", "r3o", "r4o"];

let segmenterPromise: Promise<RvmSegmenter> | null = null;

const rvmStats: RvmStats = {
  backend: null,
  loaded: false,
  loadMs: 0,
  frames: 0,
  totalMs: 0,
  lastMs: 0,
  minMs: 0,
  maxMs: 0,
  reset() {
    this.frames = 0;
    this.totalMs = 0;
    this.lastMs = 0;
    this.minMs = 0;
    this.maxMs = 0;
  },
};

if (typeof window !== "undefined") {
  (window as unknown as { __rvmStats: RvmStats }).__rvmStats = rvmStats;
}

// The WASM build needs its .wasm files served somewhere; point at the CDN for
// the exact installed version so it matches our bundled JS.
function configureWasm(): void {
  if (typeof window === "undefined") return;
  ort.env.wasm.wasmPaths = WASM_CDN;
  // Multi-threaded wasm needs SharedArrayBuffer, which requires
  // cross-origin isolation — absent on plain dev/deploy, so stay single
  // thread and avoid a silent .threaded.wasm fetch failure.
  ort.env.wasm.numThreads =
    typeof crossOriginIsolated === "boolean" && crossOriginIsolated ? 2 : 1;
}

function webgpuAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!(navigator as unknown as { gpu?: unknown }).gpu
  );
}

function epOverride(): "webgpu" | "wasm" | null {
  if (typeof window === "undefined") return null;
  const ep = new URLSearchParams(window.location.search).get("ep");
  return ep === "webgpu" || ep === "wasm" ? ep : null;
}

// WebGPU init can hang instead of erroring (same failure class as the
// MediaPipe GPU delegate), so bound it with a real timeout and let the caller
// fall back to WASM.
function createWithTimeout(
  executionProviders: string[]
): Promise<ort.InferenceSession> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("RVM WebGPU init timed out")),
      WEBGPU_TIMEOUT_MS
    );
    ort.InferenceSession.create(MODEL_URL, { executionProviders })
      .then((session) => {
        clearTimeout(timer);
        resolve(session);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// A session that creates cleanly can still fail its first real `run()` — the
// official RVM ONNX rejects on onnxruntime-web's WebGPU EP (recurrent ops).
// Do one probe run at the real input resolution so the backend choice is made
// before the compositor ever depends on it.
function probeSession(session: ort.InferenceSession): Promise<boolean> {
  const w = 960;
  const h = 528;
  const inputs = new Float32Array(3 * w * h);
  for (let i = 0; i < inputs.length; i++) inputs[i] = (i * 31) % 256 / 255;
  const feeds: Record<string, ort.Tensor> = {
    src: new ort.Tensor("float32", inputs, [1, 3, h, w]),
    r1i: zeroState(),
    r2i: zeroState(),
    r3i: zeroState(),
    r4i: zeroState(),
    downsample_ratio: new ort.Tensor("float32", [DOWNSAMPLE_RATIO], [1]),
  };
  return session
    .run(feeds, OUTPUT_NAMES)
    .then(() => true)
    .catch((err) => {
      console.warn("[rvm] WebGPU probe run failed:", err);
      return false;
    });
}

async function loadBackend(): Promise<RvmSegmenter> {
  configureWasm();
  const t0 = performance.now();
  const prefer = epOverride();
  let session: ort.InferenceSession | null = null;
  let backend: RvmBackend = "wasm";

  if (prefer !== "wasm" && webgpuAvailable()) {
    try {
      const candidate = await createWithTimeout(["webgpu"]);
      const ok = await withTimeout(
        probeSession(candidate),
        PROBE_TIMEOUT_MS,
        "RVM WebGPU probe run"
      ).catch((err) => {
        console.warn("[rvm] WebGPU probe run failed — falling back to WASM:", err);
        candidate.release();
        return false;
      });
      if (ok) {
        session = candidate;
        backend = "webgpu";
      }
    } catch (err) {
      console.warn("[rvm] WebGPU init failed — falling back to WASM:", err);
      session = null;
    }
    if (prefer === "webgpu" && !session) {
      throw new Error("RVM WebGPU forced but unavailable");
    }
  }

  if (!session) {
    session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
    });
  }

  const inputNames = session.inputNames;
  const outputNames = session.outputNames;
  for (const name of INPUT_NAMES) {
    if (!inputNames.includes(name)) {
      throw new Error(`RVM model missing input "${name}"`);
    }
  }
  for (const name of OUTPUT_NAMES) {
    if (!outputNames.includes(name)) {
      throw new Error(`RVM model missing output "${name}"`);
    }
  }

  rvmStats.backend = backend;
  rvmStats.loaded = true;
  rvmStats.loadMs = performance.now() - t0;

  return {
    backend,
    session,
    states: [],
    reset(this: RvmSegmenter) {
      this.states.length = 0;
    },
    dispose(this: RvmSegmenter) {
      this.session.release();
    },
  };
}

export function loadRvmSegmenter(): Promise<RvmSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = loadBackend().catch((err) => {
      segmenterPromise = null;
      throw err;
    });
  }
  return segmenterPromise;
}

// Official ONNX export requires spatial dims divisible by the decoder stride;
// rounding down to a multiple of 16 keeps any resolution valid.
function computeDims(vw: number, vh: number): { w: number; h: number } {
  const scale = Math.min(1, INPUT_LONG_SIDE / Math.max(vw, vh));
  const w = Math.max(16, Math.round((vw * scale) / 16) * 16);
  const h = Math.max(16, Math.round((vh * scale) / 16) * 16);
  return { w, h };
}

let workCanvas: HTMLCanvasElement | null = null;

function frameToTensor(
  video: HTMLVideoElement,
  w: number,
  h: number
): ort.Tensor {
  if (!workCanvas) workCanvas = document.createElement("canvas");
  workCanvas.width = w;
  workCanvas.height = h;
  const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(video, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    data[i] = px[o] / 255;
    data[n + i] = px[o + 1] / 255;
    data[2 * n + i] = px[o + 2] / 255;
  }
  return new ort.Tensor("float32", data, [1, 3, h, w]);
}

function zeroState(): ort.Tensor {
  return new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]);
}

export async function segmentFrameRvm(
  segmenter: RvmSegmenter,
  video: HTMLVideoElement
): Promise<{ mask: Float32Array; width: number; height: number } | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const { w, h } = computeDims(vw, vh);
  const src = frameToTensor(video, w, h);
  const rec = segmenter.states;

  const feeds: Record<string, ort.Tensor> = {
    src,
    r1i: rec[0] ?? zeroState(),
    r2i: rec[1] ?? zeroState(),
    r3i: rec[2] ?? zeroState(),
    r4i: rec[3] ?? zeroState(),
    downsample_ratio: new ort.Tensor("float32", [DOWNSAMPLE_RATIO], [1]),
  };

  const t0 = performance.now();
  const outs = await segmenter.session.run(feeds, OUTPUT_NAMES);

  const ms = performance.now() - t0;
  rvmStats.frames += 1;
  rvmStats.totalMs += ms;
  rvmStats.lastMs = ms;
  rvmStats.minMs = rvmStats.frames === 1 ? ms : Math.min(rvmStats.minMs, ms);
  rvmStats.maxMs = Math.max(rvmStats.maxMs, ms);

  segmenter.states = [outs.r1o, outs.r2o, outs.r3o, outs.r4o];

  const pha = outs.pha.data as Float32Array;
  const n = w * h;
  const mask = pha.length === n ? pha : new Float32Array(pha.subarray(0, n));
  return { mask, width: w, height: h };
}