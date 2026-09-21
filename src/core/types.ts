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

export type BackgroundMode = "none" | "blur" | "color" | "image";

export interface BackgroundSettings {
  mode: BackgroundMode;
  color: string;
  imageUrl: string | null;
  blurAmount: number;
}

export interface GlobalStyle {
  style: WordStyle;
  motion: WordMotion;
  transform: WordTransform;
  maxWordsPerGroup: number;
  videoEffects: VideoEffects;
  background: BackgroundSettings;
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

/** Reframe offset for the platform (9:16) crop: which part of the source
 * video fills the short-form frame, normalized so (-1,-1) = top-left,
 * (1,1) = bottom-right, (0,0) = centered (the default). */
export interface ReframeOffset {
  x: number;
  y: number;
}

export interface VideoEffects {
  cameraEvents: CameraEvent[];
  maxScale: number;
  inDuration: number;
  outDuration: number;
  /** User-picked framing for the platform crop; ignored unless a platform
   * preview/export is active. */
  reframe: ReframeOffset;
}

export type SfxDensity = "off" | "subtle" | "balanced" | "energetic" | "chaotic";
export type SfxVolume = "quiet" | "balanced" | "aggressive";
export type SfxPackId = "creator" | "cinematic" | "clean" | "meme";
/** Target short-form platform whose feed chrome + 9:16 crop the preview (and export) mirror. */
export type PreviewPlatform = "none" | "tiktok" | "reels" | "shorts";
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

// A user-maintained correction list for words Whisper reliably mishears
// (brand names, proper nouns). Applied two ways on every transcription: as a
// vocabulary hint in the Whisper prompt (biases recognition upfront) and as a
// guaranteed find-replace pass on the result (catches what the hint doesn't).
export interface DictionaryEntry {
  id: string;
  from: string;
  to: string;
}

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
  dictionary: DictionaryEntry[];
  isTranscribing: boolean;
  error: string | null;
  demoMode: boolean;
}
