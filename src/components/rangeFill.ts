import type { CSSProperties } from "react";

/** Inline style that paints a custom range input's filled portion.
 *
 * The track is drawn by `app/globals.css` as a two-stop gradient whose split
 * point is `--slider-fill`. A range input can't report its own value to CSS, so
 * every slider has to hand it that percentage. One shared computation matters
 * because the CSS fallback is a *fixed* split: a slider that forgets the var
 * (or computes it wrong) gets a plausible-looking fill that follows no rule —
 * the thumb moves and the accent bar sits somewhere unrelated, which is exactly
 * the "meter isn't filling" bug. */
export function sliderFillStyle(
  value: number,
  min: number,
  max: number
): CSSProperties {
  const span = max - min;
  const pct = span > 0 ? ((value - min) / span) * 100 : 0;
  const clamped = Math.min(100, Math.max(0, pct));
  return { "--slider-fill": `${clamped}%` } as CSSProperties;
}
