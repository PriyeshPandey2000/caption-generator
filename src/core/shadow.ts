import type { ShadowLookId, WordStyle } from "./types";

/**
 * Single source of truth for caption shadows.
 *
 * A shadow is four coupled fields, not one: blur alone cannot produce a
 * convincing result because softness, offset and opacity have to move
 * together. Blur 0 at 50% opacity is a grey ghost that reads as a bug; blur 0
 * at 90% with a real offset is an intentional print edge. So the four fields
 * are authored together as named looks, and every consumer — preview DOM,
 * export canvas, preset swatch — resolves the same spec through
 * `resolveShadowSpec` instead of re-deriving it from the raw fields. That is
 * what keeps the three renderers from drifting.
 */
export interface ShadowSpec {
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
}

export interface ShadowLook {
  id: ShadowLookId;
  label: string;
  hint: string;
  /** null renders no shadow at all. */
  spec: ShadowSpec | null;
}

export const SHADOW_LOOKS: readonly ShadowLook[] = [
  { id: "none", label: "None", hint: "No shadow", spec: null },
  {
    id: "tight",
    label: "Tight",
    hint: "Crisp depth",
    // Deliberately the historical default (0, 1, 4 @ 50%) so projects saved
    // before looks existed land on a labelled option rather than "Custom".
    spec: { color: "rgba(0,0,0,0.5)", offsetX: 0, offsetY: 1, blur: 4 },
  },
  {
    id: "soft",
    label: "Soft",
    hint: "Ambient separation",
    spec: { color: "rgba(0,0,0,0.35)", offsetX: 0, offsetY: 2, blur: 10 },
  },
  {
    id: "hard",
    label: "Hard",
    hint: "Punchy print edge",
    spec: { color: "rgba(0,0,0,0.9)", offsetX: 0, offsetY: 3, blur: 0 },
  },
];

export const DEFAULT_SHADOW_LOOK: ShadowLookId = "tight";

/**
 * The caption plate's own drop shadow, when a caption has a background box.
 * It belongs to the box rather than the glyphs, so it keeps its own tuned
 * values instead of being derived from the text shadow — but it lives here
 * because both renderers used to hardcode it separately, which is how the two
 * paths drifted. Unscaled in both paths, as it always was.
 */
export const CAPTION_PLATE_SHADOW: ShadowSpec = {
  color: "rgba(0,0,0,0.35)",
  offsetX: 0,
  offsetY: 4,
  blur: 24,
};

export function shadowLookById(id: ShadowLookId): ShadowLook {
  return SHADOW_LOOKS.find((l) => l.id === id) ?? SHADOW_LOOKS[0];
}

/**
 * True only when the user explicitly picked "None". This is the single
 * deliberate override in the whole feature: an explicit "off" outranks the
 * raw shadow fields, a preset that still carries them, and the glow entrance /
 * while-spoken recipes — so choosing None can never be silently ignored.
 */
export function isShadowDisabled(style: Partial<WordStyle>): boolean {
  return style.shadowLook === "none";
}

/**
 * The one decision every renderer makes. The raw fields are authoritative so
 * that a hand-tuned shadow, a per-word/per-speaker override, or a preset that
 * sets its own values all keep working; `shadowLook` contributes only the
 * "none" veto.
 */
export function resolveShadowSpec(style: Partial<WordStyle>): ShadowSpec | null {
  if (isShadowDisabled(style)) return null;
  if (!style.shadowColor) return null;
  return {
    color: style.shadowColor,
    offsetX: style.shadowOffsetX ?? 0,
    offsetY: style.shadowOffsetY ?? 0,
    blur: style.shadowBlur ?? 0,
  };
}

export type ShadowLookSelection = ShadowLookId | "custom";

function sameSpec(a: ShadowSpec, b: ShadowSpec): boolean {
  return (
    a.blur === b.blur &&
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    a.color === b.color
  );
}

/**
 * Which segment to light up in the Inspector. Anything that isn't exactly one
 * of the authored looks reports "custom" rather than pretending to be close,
 * so a hand-edited or preset-supplied shadow never looks untouched.
 */
export function shadowLookOf(style: Partial<WordStyle>): ShadowLookSelection {
  if (isShadowDisabled(style)) return "none";
  const spec = resolveShadowSpec(style);
  if (!spec) return "none";
  const match = SHADOW_LOOKS.find((l) => l.spec && sameSpec(l.spec, spec));
  return match ? match.id : "custom";
}

/**
 * Writes a look as both the label and the concrete fields, so the label
 * round-trips through save/load and legacy readers still see real values.
 */
export function shadowPatchForLook(id: ShadowLookId): Partial<WordStyle> {
  const spec = shadowLookById(id).spec;
  if (!spec) {
    return {
      shadowLook: "none",
      shadowColor: undefined,
      shadowOffsetX: undefined,
      shadowOffsetY: undefined,
      shadowBlur: undefined,
    };
  }
  return {
    shadowLook: id,
    shadowColor: spec.color,
    shadowOffsetX: spec.offsetX,
    shadowOffsetY: spec.offsetY,
    shadowBlur: spec.blur,
  };
}

const RGBA_RE = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/;

/** Whether the opacity fine-tune can edit this colour. */
export function hasAdjustableAlpha(color: string): boolean {
  return RGBA_RE.test(color.trim());
}

/** The colour's alpha, or null when it isn't an rgba() the slider can edit. */
export function alphaOf(color: string): number | null {
  const m = RGBA_RE.exec(color.trim());
  return m ? Number(m[4]) : null;
}

export function withAlpha(color: string, alpha: number): string {
  const m = RGBA_RE.exec(color.trim());
  if (!m) return color;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})`;
}

/**
 * Escape hatch for the 5% who want a number. Hand-editing drops the look
 * label (the control then reads "Custom") but keeps the offset, so nudging
 * blur can't silently restructure the look. Starting from "None" materialises
 * the default look first so there is always a real shadow to tune.
 */
export function shadowFineTunePatch(
  style: Partial<WordStyle>,
  patch: { blur?: number; alpha?: number }
): Partial<WordStyle> {
  const base =
    resolveShadowSpec(style) ?? shadowLookById(DEFAULT_SHADOW_LOOK).spec!;
  return {
    shadowLook: undefined,
    shadowColor:
      patch.alpha === undefined ? base.color : withAlpha(base.color, patch.alpha),
    shadowOffsetX: base.offsetX,
    shadowOffsetY: base.offsetY,
    shadowBlur: patch.blur ?? base.blur,
  };
}

/** Preview (DOM) expression of a resolved spec. Canvas blur radii and CSS
 *  shadow blur radii are both 2x the Gaussian sigma, so passing the same
 *  number to both is exact — verified, not assumed. */
export function cssShadow(spec: ShadowSpec | null, scale = 1): string | undefined {
  if (!spec) return undefined;
  const r = (v: number) => `${v * scale}px`;
  return `${r(spec.offsetX)} ${r(spec.offsetY)} ${r(spec.blur)} ${spec.color}`;
}

/** Export (canvas) expression of a resolved spec. */
export function canvasShadow(
  spec: ShadowSpec | null,
  scale: number
): { x: number; y: number; blur: number; color: string } | null {
  if (!spec) return null;
  return {
    x: spec.offsetX * scale,
    y: spec.offsetY * scale,
    blur: spec.blur * scale,
    color: spec.color,
  };
}
