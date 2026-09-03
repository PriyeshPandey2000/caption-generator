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
}

export type StyleOverrideLevel = "global" | "speaker" | "phrase" | "word";

export interface Project {
  id: string;
  name: string;
  videoUrl: string;
  videoFile?: File;
  transcription: TranscriptionResult | null;
  globalStyle: GlobalStyle;
  speakerStyles: Record<string, Partial<WordStyle>>;
  speakerMotions: Record<string, Partial<WordMotion>>;
  isTranscribing: boolean;
  error: string | null;
}
