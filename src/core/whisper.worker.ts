import { pipeline, env, type ProgressInfo } from "@huggingface/transformers";

// Under the DOM lib `self` is typed as `Window`; a module worker only needs
// this narrow slice, so cast once instead of pulling in the webworker lib.
const ctx = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void
  ) => void;
};

// Everything runs in this worker: mel extraction, tokenizer, decoder loop, and
// the WebGPU/WASM inference. Keeping it off the main thread means the editor
// stays responsive while a long clip transcribes.
env.allowLocalModels = false;

const MODEL_ID = "onnx-community/whisper-medium_timestamped";
const SAMPLE_RATE = 16_000;

type Device = "webgpu" | "wasm";

interface Transcriber {
  fn: (
    audio: Float32Array,
    options: Record<string, unknown>
  ) => Promise<{ text: string; chunks?: Array<{ text: string; timestamp: [number, number] }> }>;
  device: Device;
}

let transcriberPromise: Promise<Transcriber> | null = null;

function post(message: Record<string, unknown>): void {
  ctx.postMessage(message);
}

function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function forwardProgress(info: ProgressInfo): void {
  // Both per-file and aggregate events are forwarded; the main thread prefers
  // the aggregate one when it arrives so the percentage doesn't jump around.
  const record = info as unknown as Record<string, unknown>;
  post({
    type: "progress",
    status: typeof record.status === "string" ? record.status : "progress",
    file: typeof record.file === "string" ? record.file : undefined,
    loaded: typeof record.loaded === "number" ? record.loaded : 0,
    total: typeof record.total === "number" ? record.total : 0,
    progress: typeof record.progress === "number" ? record.progress : 0,
  });
}

async function loadTranscriber(): Promise<Transcriber> {
  if (transcriberPromise) return transcriberPromise;

  transcriberPromise = (async () => {
    if (hasWebGPU()) {
      try {
        const fn = await pipeline("automatic-speech-recognition", MODEL_ID, {
          device: "webgpu",
          // q4 on both halves: the fp32 encoder alone was ~1.2GB and caused
          // tab crashes before transcription started. This pair is ~650MB.
          dtype: { encoder_model: "q4", decoder_model_merged: "q4" },
          progress_callback: forwardProgress,
        });
        post({ type: "status", message: "Compiling shaders and warming up model…" });
        await fn(new Float32Array(SAMPLE_RATE), { language: "en" });
        return { fn: fn as unknown as Transcriber["fn"], device: "webgpu" };
      } catch (err) {
        post({
          type: "warning",
          message: `WebGPU unavailable, falling back to CPU: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }

    const fn = await pipeline("automatic-speech-recognition", MODEL_ID, {
      device: "wasm",
      dtype: "q8",
      progress_callback: forwardProgress,
    });
    return { fn: fn as unknown as Transcriber["fn"], device: "wasm" };
  })();

  return transcriberPromise;
}

function toWordTimings(
  chunks: Array<{ text: string; timestamp: [number, number] }> | undefined,
  duration: number
): Array<{ word: string; start: number; end: number }> {
  if (!chunks?.length) return [];

  const words: Array<{ word: string; start: number; end: number }> = [];
  let cursor = 0;

  for (const chunk of chunks) {
    const text = (chunk.text ?? "").trim();
    if (!text) continue;

    const [rawStart, rawEnd] = chunk.timestamp ?? [];
    let start = typeof rawStart === "number" ? rawStart : cursor;
    let end =
      typeof rawEnd === "number"
        ? rawEnd
        : start + Math.max(0.08, text.length * 0.05);

    start = Math.max(0, Math.min(start, duration));
    if (!(end > start)) end = start + Math.max(0.08, text.length * 0.05);
    end = Math.max(start + 0.01, Math.min(end, duration));

    words.push({ word: text, start, end });
    cursor = end;
  }

  return words;
}

async function run({
  audio,
  duration,
  language,
}: {
  audio: Float32Array;
  duration: number;
  language?: string;
}): Promise<void> {
  const { fn, device } = await loadTranscriber();

  post({ type: "status", message: `Transcribing on ${device}…` });

  // Multilingual model: when no language is supplied, Whisper detects it from
  // the audio. Passing one explicitly skips detection for that language.
  const output = await fn(audio, {
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5,
    ...(language ? { language, task: "transcribe" } : {}),
  });

  const words = toWordTimings(output.chunks, duration);

  post({
    type: "complete",
    device,
    text: output.text ?? "",
    duration,
    language: language ?? "auto",
    words,
  });
}

ctx.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as {
    type?: string;
    audio?: Float32Array;
    duration?: number;
    language?: string;
  };

  if (data?.type !== "transcribe" || !data.audio) return;

  run({
    audio: data.audio,
    duration: data.duration || data.audio.length / SAMPLE_RATE,
    language: data.language,
  }).catch((err) => {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  });
});
