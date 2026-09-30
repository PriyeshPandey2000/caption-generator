import { Word, WordStyle, WordMotion, WordTransform, GlobalStyle, VideoEffects, SfxSettings, BackgroundSettings, MusicSettings } from "./types";

// Vertical caption position bounds (percent of video height). Shared so the
// inspector slider and the render clamp can never drift apart.
export const MIN_CAPTION_Y = 5;
export const MAX_CAPTION_Y = 82;

// The pickable font families. Shared between the preview's floating toolbar
// and the Inspector's Global Style panel so the two can never drift apart.
export const FONT_FAMILY_OPTIONS = [
  { label: "Anton", value: "var(--font-anton), Impact, 'Arial Black', sans-serif" },
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Impact", value: "Impact, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Monospace", value: "monospace" },
  { label: "Comic Sans", value: "'Comic Sans MS', 'Chalkboard SE', sans-serif" },
];

// Default caption look — matches the "Karaoke" preset (see Presets.tsx):
// clean Inter caps, no stroke (the pill carries contrast instead), and a
// per-word highlight pill that follows whichever word is currently spoken —
// the whole line stays visible, only the active word gets the green
// background + black text, then it moves on as playback continues. Picked
// as the default because it reads as an immediate, obviously-designed result
// on first load rather than a blank/plain caption. Kept byte-for-byte equal
// to the Karaoke preset's patch so a fresh project already shows it as the
// active preset instead of looking like a separate, unlabeled style.
export const defaultWordStyle: WordStyle = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 48,
  color: "#FFFFFF",
  strokeColor: "#000000",
  strokeWidth: 0,
  // The four raw fields below are the "tight" look (see core/shadow.ts) and
  // stay the source of truth; the label only drives the Inspector's segmented
  // control. Kept in sync by hand — shadowPatchForLook("tight") must equal
  // these four values.
  shadowLook: "tight",
  shadowColor: "rgba(0,0,0,0.5)",
  shadowBlur: 4,
  shadowOffsetX: 0,
  shadowOffsetY: 1,
  textTransform: "uppercase",
  fontWeight: 800,
  letterSpacing: 0,
  maxWidth: 800,
  backgroundColor: "transparent",
  backgroundPadding: 6,
  backgroundBorderRadius: 10,
};

export const defaultMotion: WordMotion = {
  entrance: { type: "fade", from: 0, to: 1, duration: 150 },
  active: {
    type: "scale",
    scaleFrom: 100,
    scaleTo: 103,
    duration: 100,
    color: "#000000",
    backgroundColor: "#00FF66",
  },
  exit: { type: "fade", from: 1, to: 0, duration: 150 },
};

export const defaultTransform: WordTransform = {
  x: 0,
  y: 80,
  scale: 1,
};

export const defaultVideoEffects: VideoEffects = {
  cameraEvents: [],
  maxScale: 1.12,
  inDuration: 150,
  outDuration: 300,
  reframe: { x: 0, y: 0 },
};

export const defaultSfxSettings: SfxSettings = {
  enabled: false,
  density: "subtle",
  volume: "balanced",
  offsetMs: 0,
  pack: "creator",
  sfxSeed: 1,
};

export const defaultBackgroundSettings: BackgroundSettings = {
  mode: "none",
  color: "#00FF66",
  imageUrl: null,
  blurAmount: 12,
};

export const defaultMusicSettings: MusicSettings = {
  url: null,
  name: null,
  volume: 0.7,
  duckEnabled: true,
};

export const defaultGlobalStyle: GlobalStyle = {
  style: defaultWordStyle,
  motion: defaultMotion,
  transform: defaultTransform,
  maxWordsPerGroup: 4,
  videoEffects: defaultVideoEffects,
  background: defaultBackgroundSettings,
  sfx: defaultSfxSettings,
  music: defaultMusicSettings,
};

export function resolveWordStyle(
  word: Word,
  speakerStyles: Record<string, Partial<WordStyle>>,
  globalStyle: GlobalStyle
): WordStyle {
  const base = { ...globalStyle.style };
  const speakerOverride = word.speaker ? speakerStyles[word.speaker] : undefined;
  if (speakerOverride) Object.assign(base, speakerOverride);
  if (word.style) Object.assign(base, word.style);
  return base;
}

export function resolveWordMotion(
  word: Word,
  speakerMotions: Record<string, Partial<WordMotion>>,
  globalStyle: GlobalStyle
): WordMotion {
  const base = { ...globalStyle.motion };
  const speakerOverride = word.speaker ? speakerMotions[word.speaker] : undefined;
  if (speakerOverride) {
    if (speakerOverride.entrance) base.entrance = { ...base.entrance, ...speakerOverride.entrance };
    if (speakerOverride.active) base.active = { ...base.active, ...speakerOverride.active };
    if (speakerOverride.exit) base.exit = { ...base.exit, ...speakerOverride.exit };
    if (speakerOverride.emphasis) base.emphasis = { ...base.emphasis, ...speakerOverride.emphasis };
  }
  if (word.animation) {
    if (word.animation.entrance) base.entrance = { ...base.entrance, ...word.animation.entrance };
    if (word.animation.active) base.active = { ...base.active, ...word.animation.active };
    if (word.animation.exit) base.exit = { ...base.exit, ...word.animation.exit };
    if (word.animation.emphasis) base.emphasis = { ...base.emphasis, ...word.animation.emphasis };
  }
  return base;
}

export function resolveWordTransform(
  word: Word,
  globalStyle: GlobalStyle
): WordTransform {
  const base = { ...globalStyle.transform };
  if (word.transform) Object.assign(base, word.transform);
  return base;
}

/**
 * Composes a preset / choreography bundle onto the current global style.
 *
 * Bundles declare their `style` as a Partial, but a shallow spread replaced the
 * entire WordStyle — so every field a bundle didn't happen to mention was
 * silently reset. That is what made clicking a style card wipe the caption's
 * drop shadow *and* its black outline, and what made the choreography presets
 * lose the shadow's offset and turn a downward drop into a centred halo.
 * Merging one level deeper means a bundle only changes what it names; to clear
 * a field, name it explicitly (`shadowLook: "none"`, `strokeWidth: 0`).
 *
 * `motion` is deliberately NOT merged: every bundle specifies entrance, active
 * and exit, and omitting `emphasis` is how a bundle says "no global emphasis"
 * (choreography assigns those per word instead). Merging it would leak a stale
 * global emphasis onto words the bundle never emphasised.
 */
export function mergeGlobalStyle(
  base: GlobalStyle,
  patch: Partial<GlobalStyle>
): GlobalStyle {
  return {
    ...base,
    ...patch,
    style: { ...base.style, ...patch.style },
    transform: { ...base.transform, ...patch.transform },
  };
}
