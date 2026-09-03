export interface WordStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  backgroundColor?: string;
  backgroundPadding?: number;
  backgroundBorderRadius?: number;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  fontWeight?: number;
  letterSpacing?: number;
  lineHeight?: number;
  opacity?: number;
  maxWidth?: number;
  textAlign?: "left" | "center" | "right";
}

export interface WordMotion {
  entrance?: AnimationRecipe;
  active?: AnimationRecipe;
  exit?: AnimationRecipe;
  emphasis?: AnimationRecipe;
}

export interface AnimationRecipe {
  type: "scale" | "fade" | "slide" | "glow" | "pop" | "bounce" | "none";
  from?: number;
  to?: number;
  duration?: number;
  delay?: number;
  easing?: string;
  color?: string;
  glowRadius?: number;
  scaleFrom?: number;
  scaleTo?: number;
}

export interface WordTransform {
  x: number;
  y: number;
  scale: number;
}

export interface Word {
  id: string;
  text: string;
  start: number;
  end: number;
  speaker?: string;
  style?: Partial<WordStyle>;
  transform?: Partial<WordTransform>;
  animation?: Partial<WordMotion>;
}

export interface CaptionGroup {
  id: string;
  wordIds: string[];
  start: number;
  end: number;
  speaker?: string;
}

export interface Segment {
  id: string;
  text: string;
  start: number;
  end: number;
  words: Word[];
}

export interface TranscriptionResult {
  language: string;
  duration: number;
  segments: Segment[];
  words: Word[];
  captionGroups: CaptionGroup[];
}

export interface GlobalStyle {
  style: WordStyle;
  motion: WordMotion;
  transform: WordTransform;
  maxWordsPerGroup: number;
  videoEffects: VideoEffects;
  sfx: SfxSettings;
}

export interface CameraEvent {
  id: string;
  start: number;
  peak: number;
  end: number;
  type: "zoom" | "shake" | "pan" | "rotate";
  intensity: number;
  source: "auto" | "word" | "punchline" | "speaker" | "manual";
}

export interface VideoEffects {
  cameraEvents: CameraEvent[];
  maxScale: number;
  inDuration: number;
  outDuration: number;
}

export type SfxDensity = "off" | "subtle" | "balanced" | "energetic" | "chaotic";
export type SfxVolume = "quiet" | "balanced" | "aggressive";
export type SfxPackId = "creator" | "cinematic" | "clean" | "meme";
export type SfxRole = "emphasis" | "punchline" | "cameraPunch" | "transition";
export type SfxName =
  | "whoosh"
  | "reverse-whoosh"
  | "pop"
  | "hit"
  | "ding"
  | "riser"
  | "snap"
  | "thump"
  | "click"
  | "soft-pop"
  | "bass-hit"
  | "record-scratch";

export interface SfxSettings {
  enabled: boolean;
  density: SfxDensity;
  volume: SfxVolume;
  offsetMs: number;
  pack: SfxPackId;
  sfxSeed: number;
}

export interface SfxEvent {
  id: string;
  start: number;
  duration?: number;
  role: SfxRole;
  sound: SfxName;
  volume: number;
  pitch?: number;
  offsetMs?: number;
  source: "auto" | "manual" | "choreography";
  sourceWordIds?: string[];
}

export interface Composition {
  sfxEvents: SfxEvent[];
  // Per-word manual decisions ("none" = silent, or a specific sound). Any word
  // present here is excluded from automatic generation; "none" plays nothing,
  // a sound plays via a manual event. Absent word = "inherit" (auto).
  sfxOverrides?: Record<string, "none" | SfxName>;
}

export type StyleOverrideLevel = "global" | "speaker" | "phrase" | "word";

export interface Project {
  id: string;
  name: string;
  videoUrl: string;
  videoFile?: File;
  transcription: TranscriptionResult | null;
  globalStyle: GlobalStyle;
  composition: Composition;
  speakerStyles: Record<string, Partial<WordStyle>>;
  speakerMotions: Record<string, Partial<WordMotion>>;
  isTranscribing: boolean;
  error: string | null;
}
