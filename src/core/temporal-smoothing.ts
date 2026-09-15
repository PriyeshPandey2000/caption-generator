// Model-agnostic mask post-processing shared by every segmentation backend —
// works on the plain per-pixel confidence array regardless of which model
// produced it, so swapping MediaPipe for RVM/MODNet later needs no changes
// here.

// Temporal: per-frame masks flicker (lighting/motion shifts the boundary
// slightly frame to frame). An exponential moving average against the
// previous frame's mask kills that without visible lag at normal playback
// speed. `prevMask` must be the same length as `currentMask` (same working
// resolution) — call sites are responsible for resetting to null when the
// segmenter's output size changes (e.g. on video swap).
export function smoothMaskTemporal(
  prevMask: Float32Array | null,
  currentMask: Float32Array,
  alpha = 0.5
): Float32Array {
  if (!prevMask || prevMask.length !== currentMask.length) return currentMask;
  const out = new Float32Array(currentMask.length);
  for (let i = 0; i < currentMask.length; i++) {
    out[i] = alpha * currentMask[i] + (1 - alpha) * prevMask[i];
  }
  return out;
}

// Spatial: raw segmentation output is close to binary, which cuts the subject
// out with a hard "paper cutout" edge. A small box blur on the alpha channel
// itself (not the color image) softens that boundary before compositing —
// cheap (separable two-pass box blur), no dependency, meaningfully better
// perceived quality for very little cost.
export function featherMask(
  mask: Float32Array,
  width: number,
  height: number,
  radiusPx = 4
): Float32Array {
  if (radiusPx <= 0) return mask;
  const horizontal = boxBlur1D(mask, width, height, radiusPx, true);
  return boxBlur1D(horizontal, width, height, radiusPx, false);
}

function boxBlur1D(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean
): Float32Array {
  const out = new Float32Array(src.length);
  const span = radius * 2 + 1;

  if (horizontal) {
    for (let y = 0; y < height; y++) {
      const rowStart = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x++) {
        sum += src[rowStart + clamp(x, 0, width - 1)];
      }
      for (let x = 0; x < width; x++) {
        out[rowStart + x] = sum / span;
        const addX = clamp(x + radius + 1, 0, width - 1);
        const subX = clamp(x - radius, 0, width - 1);
        sum += src[rowStart + addX] - src[rowStart + subX];
      }
    }
  } else {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) {
        sum += src[clamp(y, 0, height - 1) * width + x];
      }
      for (let y = 0; y < height; y++) {
        out[y * width + x] = sum / span;
        const addY = clamp(y + radius + 1, 0, height - 1);
        const subY = clamp(y - radius, 0, height - 1);
        sum += src[addY * width + x] - src[subY * width + x];
      }
    }
  }

  return out;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
