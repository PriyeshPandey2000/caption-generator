# Task: RVM (Robust Video Matting) proof-of-concept for background removal

Paste everything below to the agent doing this work. It's self-contained.

---

## Context — what already exists

This is `caption-generator` (Next.js 16, TypeScript, Zustand store), a browser-based caption/video editor. On branch `feature/background-removal`, a **preview-only background removal feature** already exists and works:

- `src/core/background-removal.ts` — loads a MediaPipe Tasks Vision `ImageSegmenter` (the single-class `selfie_segmenter` model), lazy-loaded singleton, `delegate: "CPU"` (important — see Gotchas below). Exposes `segmentFrame(segmenter, video, timestampMs) -> { mask: Float32Array, width: number, height: number } | null`, where `mask` is a per-pixel confidence value in `[0,1]`, `1 = person`.
- `src/core/temporal-smoothing.ts` — model-agnostic post-processing on that mask:
  - `smoothMaskTemporal(prevMask, currentMask, alpha)` — exponential moving average across frames, kills flicker.
  - `featherMask(mask, width, height, radiusPx)` — box blur on the alpha channel, softens the "paper cutout" hard edge.
- `src/components/BackgroundLayer.tsx` — the compositor. Renders a `<canvas>` sibling to the real `<video>` element. Each `requestAnimationFrame` tick (only while playing): captures a frame, segments it, applies temporal smoothing + feathering, composites the subject over the chosen background (blur of original / solid color / static image) using canvas `destination-in` compositing. Mirrors an existing camera-zoom rAF pattern already in `VideoPreview.tsx` for consistency.
- `src/components/BackgroundPanel.tsx` — UI: None/Blur/Color/Image mode buttons, wired as a third tab next to "Style"/"Presets" in the editor.
- `src/core/types.ts` / `src/store/editor-store.ts` — `BackgroundSettings` on `GlobalStyle`, store actions `setBackgroundMode` / `setBackgroundColor` / `setBackgroundImage` / `setBackgroundBlurAmount`, following the exact same pattern as the existing `SfxSettings` in the same files (copy that pattern for anything new).

**This MediaPipe-based version works and is the fallback/baseline.** Do not break it.

## Why RVM, decided already — don't re-litigate

Two problems exist with the MediaPipe baseline:
1. **Edge jaggedness** — near-binary mask, not a true alpha matte. Feathering helps but is a patch.
2. **Frame-to-frame flicker** — MediaPipe scores each frame independently, zero memory of the previous frame. This is architectural, not fixable by better upsampling.

RVM ([Robust Video Matting](https://github.com/PeterL1n/RobustVideoMatting)) fixes both: it's a **recurrent** network (carries hidden state frame-to-frame, so temporal stability is built into the model) and outputs a **continuous alpha matte** (preserves hair-level edge detail) instead of a near-binary mask.

Confirmed runnable in-browser via `onnxruntime-web`:
- WebGPU backend on Chrome/Edge/Safari 18+ for real-time performance (~10-20ms/frame per the model author's own web demo).
- WASM backend as fallback for older browsers/no WebGPU.

## The actual task

Build RVM as an **alternate, swappable segmentation backend** — do NOT replace or modify the MediaPipe path. This is a proof-of-concept to be measured against the existing baseline, not a ship-it-immediately swap. Specifically:

1. Add `onnxruntime-web` as a dependency.
2. Get an RVM ONNX model running client-side. Use a quantized/mobile variant (mobilenetv3 backbone, not resnet50 — smaller, faster) — the model author publishes ONNX exports; find and use an official one, don't try to convert/train anything. Note RVM's recurrent state: it takes `r1i, r2i, r3i, r4i` (previous frame's hidden states) as inputs and returns `r1o, r2o, r3o, r4o` as outputs to feed into the next frame's call, plus a `downsample_ratio` parameter (start around 0.25-0.4 for real-time perf, tune from there). Zero-initialize the recurrent state tensors on the first frame / whenever the mode is freshly enabled.
3. Create `src/core/background-removal-rvm.ts` with an interface **parallel to** `background-removal.ts`'s `segmentFrame` (same shape: takes a video element + returns a mask/alpha buffer + dimensions) so it can be dropped into `BackgroundLayer.tsx`'s compositing logic with minimal changes — RVM's own output is already a proper alpha matte, so it does NOT need `temporal-smoothing.ts`'s `smoothMaskTemporal` (RVM's recurrence replaces that), but reusing `featherMask` lightly (small radius) is still fine if edges need it.
4. Wire it as a **selectable backend for testing** (a dev-only toggle or a query param or a temporary second set of mode buttons — your call, but it must NOT remove or risk the shipped MediaPipe path, and must default to MediaPipe unless explicitly switched).
5. Delegate/backend selection: try WebGPU first, detect failure/unavailability, fall back to WASM. **Do not assume WebGPU works — test it for real.** (See Gotcha below — this exact class of assumption already bit us once this session.)

## Explicitly out of scope — do not touch

- **Export.** The exported MP4 does not include any background removal yet (baseline or RVM). `ExportPanel.tsx`'s export is a single native `ffmpeg.wasm` filter-graph pass with zero JS-side per-frame processing today — there is nothing to hook into here, and building that pipeline is separate, larger, already-scoped work. Do not attempt it.
- Do not modify `background-removal.ts`, `temporal-smoothing.ts`'s existing exports, or the MediaPipe path in `BackgroundLayer.tsx` except to add the new backend alongside it.
- Do not touch anything about captions, transcription, dictionary, or export pipelines — unrelated systems in this repo.

## Verification — how to know if it's actually better

There is an established baseline screenshot recipe from this session, at a fixed reproducible frame, for exactly this kind of before/after comparison:

1. `npm run dev`, open `http://localhost:3000`.
2. Click "Try it with sample captions" (loads a real 40s talking-head demo video already in the repo at `public/samples/demo-talking-head.mp4`).
3. Open the "Background" tab in the right panel.
4. For each mode you're comparing: click the mode button, then in the browser console (or via automation) run:
   ```js
   const v = document.querySelector('video');
   v.currentTime = 17.4;
   await new Promise(r => setTimeout(r, 100));
   await v.play();
   while (v.currentTime < 18.0) { await new Promise(r => setTimeout(r, 16)); }
   v.pause();
   ```
   This seeks to, plays through, and pauses at exactly **t=18.0s** — the same frame used for the existing MediaPipe baseline screenshots (subject mid-gesture, hands visible, decent edge complexity around the hair).
5. Screenshot the video preview canvas at that frame for MediaPipe (baseline, already captured this session) vs. RVM (new). Compare edge sharpness and — more importantly, since it requires video playback, not a single frame — play a few seconds continuously and watch for flicker/ghosting around the hair/edges, which is the harder problem RVM specifically targets.
6. Also record `ms/frame` for the RVM path (both WebGPU and WASM) on whatever hardware you're testing on — this is a real, unverified number until measured, don't report it as fact from the paper/demo alone.

## One concrete gotcha from this session — don't repeat it

When wiring the MediaPipe `ImageSegmenter`, `delegate: "GPU"` **hung indefinitely with no error, no rejection, no timeout** in one tested environment — looked like a genuine "it's working" state but never resolved. Switching to `delegate: "CPU"` fixed it immediately. **Do not assume GPU/WebGPU works — verify it actually resolves and produces output within a reasonable time, with a real timeout and fallback to WASM if it doesn't.** This is exactly the class of risk RVM's WebGPU path also carries; test it for real on real hardware before claiming it works.

## Code style / conventions to match

- No comments explaining *what* code does — only *why*, for non-obvious constraints (see the existing files for tone/density of comments — sparse, load-bearing only).
- Reuse the existing `SfxSettings`/store-action pattern for any new settings (don't invent a new pattern).
- Run `npx tsc --noEmit` and `npx eslint <changed files>` before considering anything done — both must pass clean.
- Test live in the browser (the dev server + manual interaction, or Playwright-style automation) before reporting anything as working — this repo's whole session history is full of "looked right in code, was wrong live" — don't trust it until you've actually seen it composite correctly on screen.
