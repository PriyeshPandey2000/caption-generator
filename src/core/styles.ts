import { Word, WordStyle, WordMotion, WordTransform, GlobalStyle, VideoEffects } from "./types";

export const defaultWordStyle: WordStyle = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 48,
  color: "#FFFFFF",
  strokeColor: "#000000",
  strokeWidth: 2,
  shadowColor: "rgba(0,0,0,0.5)",
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  textTransform: "uppercase",
  fontWeight: 800,
  letterSpacing: 2,
  textAlign: "center",
  maxWidth: 800,
};

export const defaultMotion: WordMotion = {
  entrance: {
    type: "scale",
    scaleFrom: 80,
    scaleTo: 100,
    duration: 180,
    easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  },
  active: {
    type: "scale",
    scaleFrom: 100,
    scaleTo: 125,
    duration: 100,
    color: "#FFD700",
  },
  exit: {
    type: "fade",
    from: 1,
    to: 0,
    duration: 120,
    easing: "ease-out",
  },
};

export const defaultTransform: WordTransform = {
  x: 0,
  y: 40,
  scale: 1,
};

export const defaultVideoEffects: VideoEffects = {
  cameraEvents: [],
  maxScale: 1.12,
  inDuration: 150,
  outDuration: 300,
};

export const defaultGlobalStyle: GlobalStyle = {
  style: defaultWordStyle,
  motion: defaultMotion,
  transform: defaultTransform,
  maxWordsPerGroup: 4,
  videoEffects: defaultVideoEffects,
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
