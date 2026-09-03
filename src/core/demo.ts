import { Word, CaptionGroup, Segment, TranscriptionResult } from "./types";
import { v4 as uuid } from "uuid";
import { groupWordsIntoCaptions } from "./captions";

const RAW_DEMO_WORDS = [
  { text: "This", s: 0.0, e: 0.35 },
  { text: "is", s: 0.35, e: 0.5 },
  { text: "CaptionLab", s: 0.5, e: 1.0 },
  { text: "the", s: 1.3, e: 1.45 },
  { text: "fastest", s: 1.45, e: 1.85 },
  { text: "way", s: 1.85, e: 2.0 },
  { text: "to", s: 2.0, e: 2.1 },
  { text: "make", s: 2.1, e: 2.3 },
  { text: "your", s: 2.3, e: 2.45 },
  { text: "videos", s: 2.45, e: 2.8 },
  { text: "pop.", s: 2.8, e: 3.2 },
  { text: "Every", s: 3.6, e: 3.8 },
  { text: "single", s: 3.8, e: 4.0 },
  { text: "word", s: 4.0, e: 4.15 },
  { text: "is", s: 4.15, e: 4.25 },
  { text: "customisable.", s: 4.25, e: 4.9 },
  { text: "But", s: 5.3, e: 5.45 },
  { text: "you", s: 5.45, e: 5.6 },
  { text: "never", s: 5.6, e: 5.8 },
  { text: "have", s: 5.8, e: 5.95 },
  { text: "to", s: 5.95, e: 6.05 },
  { text: "customise", s: 6.05, e: 6.4 },
  { text: "anything.", s: 6.4, e: 6.9 },
  { text: "Drag", s: 7.3, e: 7.5 },
  { text: "a", s: 7.5, e: 7.6 },
  { text: "word,", s: 7.6, e: 7.9 },
  { text: "scale", s: 7.9, e: 8.1 },
  { text: "it", s: 8.1, e: 8.2 },
  { text: "to", s: 8.2, e: 8.3 },
  { text: "become", s: 8.3, e: 8.55 },
  { text: "big", s: 8.55, e: 8.75 },
  { text: "type.", s: 8.75, e: 9.1 },
  { text: "Hit", s: 9.5, e: 9.65 },
  { text: "MrBeast", s: 9.65, e: 10.1 },
  { text: "mode", s: 10.1, e: 10.35 },
  { text: "for", s: 10.35, e: 10.5 },
  { text: "instant", s: 10.5, e: 10.75 },
  { text: "energy.", s: 10.75, e: 11.15 },
];

// Hand-authored timings above butt words up against each other exactly
// (end === next start) — real speech (and real Whisper output) always has a
// small gap. Trim a natural pause before any word that touches the next one,
// so the timeline's drag-to-retime handles have room to work in the demo.
const WORD_GAP = 0.04;
const DEMO_WORDS = RAW_DEMO_WORDS.map((w, i) => {
  const next = RAW_DEMO_WORDS[i + 1];
  if (!next || next.s > w.e) return w;
  return { ...w, e: Math.max(w.s + 0.05, w.e - WORD_GAP) };
});

export function createDemoTranscription(): TranscriptionResult {
  const words: Word[] = DEMO_WORDS.map((w) => ({
    id: uuid(),
    text: w.text,
    start: w.s,
    end: w.e,
  }));

  const captionGroups: CaptionGroup[] = groupWordsIntoCaptions(words, 4);

  const segments: Segment[] = [
    {
      id: uuid(),
      text: "This is CaptionLab, the fastest way to make your videos pop.",
      start: 0.0,
      end: 3.2,
      words: words.slice(0, 11),
    },
    {
      id: uuid(),
      text: "Every single word is customisable.",
      start: 3.6,
      end: 4.9,
      words: words.slice(11, 16),
    },
    {
      id: uuid(),
      text: "But you never have to customise anything.",
      start: 5.3,
      end: 6.9,
      words: words.slice(16, 23),
    },
    {
      id: uuid(),
      text: "Drag a word, scale it to become big type.",
      start: 7.3,
      end: 9.1,
      words: words.slice(23, 32),
    },
    {
      id: uuid(),
      text: "Hit MrBeast mode for instant energy.",
      start: 9.5,
      end: 11.15,
      words: words.slice(32, 39),
    },
  ];

  return {
    language: "en",
    duration: 11.2,
    segments,
    words,
    captionGroups,
  };
}
