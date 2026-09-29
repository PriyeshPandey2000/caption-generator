/* Detects whether a caption font actually ships more than one weight.

   A single-weight face (Anton, Impact, Georgia, Comic Sans) still accepts
   font-weight 100..900 and still records the number, but renders identical
   glyphs — so the Font Weight slider is a silent no-op that still changes the
   value baked into the export. Comparing rendered advance widths at 100 vs 900
   detects that directly, which beats hardcoding a font list.

   Runs in the browser only; callers must treat SSR as "supported" so the first
   paint isn't disabled. */

function resolveFamily(family: string): string {
  const el = document.createElement("span");
  // canvas can't parse var(), so resolve `var(--font-anton)` through the DOM first
  el.style.cssText =
    "position:absolute;left:-9999px;top:0;font-size:100px;white-space:nowrap;" +
    `font-family:${family}`;
  document.body.appendChild(el);
  const resolved = getComputedStyle(el).fontFamily;
  el.remove();
  return resolved;
}

export function fontSupportsWeightRange(family: string): boolean {
  if (typeof document === "undefined") return true;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return true;

  const resolved = resolveFamily(family);
  const sample = "Handgloves 0123";
  ctx.font = `100 100px ${resolved}`;
  const light = ctx.measureText(sample).width;
  ctx.font = `900 100px ${resolved}`;
  const bold = ctx.measureText(sample).width;

  return Math.abs(bold - light) > 0.5;
}
