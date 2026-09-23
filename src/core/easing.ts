// Shared easing for the time-driven caption animations. Both the live DOM
// preview (WordSpan) and the export renderer (evaluateWordVisuals) sample the
// same progress -> eased-progress curve, so a cubic-bezier overshoot looks
// identical on screen and in the rendered MP4.

export type EaseFn = (p: number) => number;

function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const ax = 3 * x1;
  const bx = 3 * (x2 - x1) - ax;
  const cx = 1 - ax - bx;
  const ay = 3 * y1;
  const by = 3 * (y2 - y1) - ay;
  const cy = 1 - ay - by;
  // x(t) is monotone in t for CSS-valid control points (x1, x2 in [0,1]), so
  // invert it with a fixed-iteration binary search and evaluate y at that t.
  const sampleX = (t: number) => ((cx * t + bx) * t + ax) * t;
  const sampleY = (t: number) => ((cy * t + by) * t + ay) * t;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (sampleX(mid) < p) lo = mid;
      else hi = mid;
    }
    return sampleY((lo + hi) / 2);
  };
}

const NAMED_EASES: Record<string, EaseFn> = {
  linear: (p) => p,
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  "ease-in": cubicBezier(0.42, 0, 1, 1),
  "ease-out": cubicBezier(0, 0, 0.58, 1),
  "ease-in-out": cubicBezier(0.42, 0, 0.58, 1),
};

const CUBIC_RE = /^cubic-bezier\(\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*\)$/;

export function parseEasing(easing: string | undefined): EaseFn {
  if (!easing) return NAMED_EASES.linear;
  const named = NAMED_EASES[easing];
  if (named) return named;
  const m = CUBIC_RE.exec(easing);
  if (m) {
    const x1 = parseFloat(m[1]);
    const x2 = parseFloat(m[3]);
    // CSS requires the two x control points to stay in [0,1]; y1/y2 may
    // legitimately overshoot below 0 / above 1 for anticipation and overshoot
    // curves. If x is out of range the cubic is malformed, so fall back to
    // linear rather than silently rendering a broken curve.
    if (x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1) {
      return cubicBezier(x1, parseFloat(m[2]), x2, parseFloat(m[4]));
    }
  }
  return NAMED_EASES.linear;
}

// Applies the recipe's easing to a raw 0..1 progress. Output is deliberately
// NOT clamped: an overshoot curve (control y outside [0,1]) may exceed the
// range, which is what produces the "pop" spring back. Call sites clamp where
// the value is an opacity (must stay 0..1) or font-size (must stay >= 0).
export function easeProgress(progress: number, easing?: string): number {
  return parseEasing(easing)(progress);
}