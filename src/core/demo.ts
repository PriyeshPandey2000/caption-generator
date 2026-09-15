import { Word, CaptionGroup, Segment, TranscriptionResult } from "./types";
import { v4 as uuid } from "uuid";
import { groupWordsIntoCaptions } from "./captions";

// Real Whisper transcript of public/samples/demo-talking-head.mp4, run through
// the same even-split-per-segment algorithm production uses in
// parseSegmentsToWords (Groq's segments don't carry nested word timestamps,
// so real uploads hit that fallback path too — this demo matches it exactly).
export const DEMO_VIDEO_URL = "/samples/demo-talking-head.mp4";

const RAW_DEMO_WORDS = [
  { text: "had", s: 0.0, e: 0.277 },
  { text: "a", s: 0.277, e: 0.553 },
  { text: "coffee", s: 0.553, e: 0.83 },
  { text: "and", s: 0.83, e: 1.107 },
  { text: "a", s: 1.107, e: 1.383 },
  { text: "shower.", s: 1.383, e: 1.66 },
  { text: "And", s: 1.66, e: 2.16 },
  { text: "yesterday", s: 2.16, e: 2.66 },
  { text: "we", s: 2.66, e: 3.16 },
  { text: "got", s: 3.16, e: 3.66 },
  { text: "three", s: 3.66, e: 4.16 },
  { text: "more", s: 4.16, e: 4.66 },
  { text: "sponsors,", s: 4.66, e: 5.16 },
  { text: "which", s: 5.16, e: 5.66 },
  { text: "is", s: 5.66, e: 6.16 },
  { text: "insane.", s: 6.16, e: 6.66 },
  { text: "This", s: 7.26, e: 7.467 },
  { text: "little", s: 7.467, e: 7.673 },
  { text: "project", s: 7.673, e: 7.88 },
  { text: "that", s: 7.88, e: 8.087 },
  { text: "I", s: 8.087, e: 8.293 },
  { text: "built,", s: 8.293, e: 8.5 },
  { text: "I", s: 8.5, e: 8.736 },
  { text: "spent", s: 8.736, e: 8.972 },
  { text: "a", s: 8.972, e: 9.208 },
  { text: "few", s: 9.208, e: 9.444 },
  { text: "hours", s: 9.444, e: 9.68 },
  { text: "last", s: 9.68, e: 9.916 },
  { text: "Thursday", s: 9.916, e: 10.152 },
  { text: "working", s: 10.152, e: 10.388 },
  { text: "on", s: 10.388, e: 10.624 },
  { text: "it.", s: 10.624, e: 10.86 },
  { text: "I've", s: 10.86, e: 11.18 },
  { text: "been", s: 11.18, e: 11.5 },
  { text: "working", s: 11.5, e: 11.82 },
  { text: "on", s: 11.82, e: 12.14 },
  { text: "it", s: 12.14, e: 12.46 },
  { text: "a", s: 12.46, e: 12.78 },
  { text: "lot", s: 12.78, e: 13.1 },
  { text: "since.", s: 13.1, e: 13.42 },
  { text: "It's", s: 13.42, e: 13.78 },
  { text: "gone", s: 13.78, e: 14.14 },
  { text: "in", s: 14.14, e: 14.5 },
  { text: "the", s: 14.5, e: 14.86 },
  { text: "last", s: 14.86, e: 15.22 },
  { text: "48", s: 15.22, e: 15.58 },
  { text: "hours", s: 15.58, e: 15.94 },
  { text: "from", s: 15.94, e: 16.3 },
  { text: "$0", s: 16.3, e: 16.66 },
  { text: "a", s: 16.66, e: 17.02 },
  { text: "month", s: 17.02, e: 17.38 },
  { text: "to", s: 17.38, e: 17.806 },
  { text: "$7,600", s: 17.806, e: 18.231 },
  { text: "a", s: 18.231, e: 18.657 },
  { text: "month,", s: 18.657, e: 19.083 },
  { text: "which", s: 19.083, e: 19.509 },
  { text: "is", s: 19.509, e: 19.934 },
  { text: "insane.", s: 19.934, e: 20.36 },
  { text: "Shout", s: 20.36, e: 20.577 },
  { text: "out", s: 20.577, e: 20.794 },
  { text: "to", s: 20.794, e: 21.011 },
  { text: "the", s: 21.011, e: 21.229 },
  { text: "last", s: 21.229, e: 21.446 },
  { text: "three", s: 21.446, e: 21.663 },
  { text: "sponsors,", s: 21.663, e: 21.88 },
  { text: "Nevo", s: 21.88, e: 22.327 },
  { text: "from", s: 22.327, e: 22.773 },
  { text: "Postiz,", s: 22.773, e: 23.22 },
  { text: "Chris", s: 23.22, e: 23.667 },
  { text: "from", s: 23.667, e: 24.113 },
  { text: "Bullseye,", s: 24.113, e: 24.56 },
  { text: "and", s: 24.56, e: 25.049 },
  { text: "Jackie", s: 25.049, e: 25.537 },
  { text: "from", s: 25.537, e: 26.026 },
  { text: "Browser", s: 26.026, e: 26.514 },
  { text: "Blast", s: 26.514, e: 27.003 },
  { text: "at", s: 27.003, e: 27.491 },
  { text: "Indexy.", s: 27.491, e: 27.98 },
  { text: "oh,", s: 27.98, e: 28.715 },
  { text: "the", s: 28.715, e: 29.45 },
  { text: "thing", s: 29.45, e: 30.185 },
  { text: "is,", s: 30.185, e: 30.92 },
  { text: "I", s: 31.36, e: 31.66 },
  { text: "now", s: 31.66, e: 31.96 },
  { text: "have", s: 31.96, e: 32.26 },
  { text: "this", s: 32.26, e: 32.56 },
  { text: "problem", s: 32.56, e: 32.86 },
  { text: "in", s: 32.86, e: 33.16 },
  { text: "front", s: 33.16, e: 33.46 },
  { text: "of", s: 33.46, e: 33.76 },
  { text: "me,", s: 33.76, e: 34.06 },
  { text: "which", s: 34.08, e: 34.405 },
  { text: "is", s: 34.405, e: 34.73 },
  { text: "how", s: 34.73, e: 35.055 },
  { text: "to", s: 35.055, e: 35.38 },
  { text: "keep", s: 35.38, e: 35.705 },
  { text: "the", s: 35.705, e: 36.03 },
  { text: "traffic", s: 36.03, e: 36.355 },
  { text: "high", s: 36.355, e: 36.68 },
  { text: "on", s: 36.68, e: 36.856 },
  { text: "Can", s: 36.856, e: 37.032 },
  { text: "I", s: 37.032, e: 37.208 },
  { text: "Vibe", s: 37.208, e: 37.384 },
  { text: "Coding?", s: 37.384, e: 37.56 },
  { text: "It", s: 37.68, e: 37.877 },
  { text: "is", s: 37.877, e: 38.073 },
  { text: "really", s: 38.073, e: 38.27 },
  { text: "high", s: 38.27, e: 38.467 },
  { text: "right", s: 38.467, e: 38.663 },
  { text: "now.", s: 38.663, e: 38.86 },
  { text: "Since", s: 38.96, e: 39.307 },
  { text: "midnight", s: 39.307, e: 39.653 },
  { text: "today,", s: 39.653, e: 40.0 },
];

// Even-split timings from the same segment butt up against each other exactly
// (end === next start) — real speech (and real Whisper output) always has a
// small gap. Trim a natural pause before any word that touches the next one,
// so the timeline's drag-to-retime handles have room to work in the demo.
const WORD_GAP = 0.04;
const DEMO_WORDS = RAW_DEMO_WORDS.map((w, i) => {
  const next = RAW_DEMO_WORDS[i + 1];
  if (!next || next.s > w.e) return w;
  return { ...w, e: Math.max(w.s + 0.05, w.e - WORD_GAP) };
});

const SEGMENT_TEXTS: Array<{ text: string; start: number; end: number; from: number; to: number }> = [
  { text: "had a coffee and a shower.", start: 0, end: 1.66, from: 0, to: 6 },
  { text: "And yesterday we got three more sponsors, which is insane.", start: 1.66, end: 6.66, from: 6, to: 16 },
  { text: "This little project that I built,", start: 7.26, end: 8.5, from: 16, to: 22 },
  { text: "I spent a few hours last Thursday working on it.", start: 8.5, end: 10.86, from: 22, to: 32 },
  { text: "I've been working on it a lot since.", start: 10.86, end: 13.42, from: 32, to: 40 },
  { text: "It's gone in the last 48 hours from $0 a month", start: 13.42, end: 17.38, from: 40, to: 51 },
  { text: "to $7,600 a month, which is insane.", start: 17.38, end: 20.36, from: 51, to: 58 },
  { text: "Shout out to the last three sponsors,", start: 20.36, end: 21.88, from: 58, to: 65 },
  { text: "Nevo from Postiz, Chris from Bullseye,", start: 21.88, end: 24.56, from: 65, to: 71 },
  { text: "and Jackie from Browser Blast at Indexy.", start: 24.56, end: 27.98, from: 71, to: 78 },
  { text: "oh, the thing is,", start: 27.98, end: 30.92, from: 78, to: 82 },
  { text: "I now have this problem in front of me,", start: 31.36, end: 34.06, from: 82, to: 91 },
  { text: "which is how to keep the traffic high", start: 34.08, end: 36.68, from: 91, to: 99 },
  { text: "on Can I Vibe Coding?", start: 36.68, end: 37.56, from: 99, to: 104 },
  { text: "It is really high right now.", start: 37.68, end: 38.86, from: 104, to: 110 },
  { text: "Since midnight today,", start: 38.96, end: 40.0, from: 110, to: 113 },
];

export function createDemoTranscription(): TranscriptionResult {
  const words: Word[] = DEMO_WORDS.map((w) => ({
    id: uuid(),
    text: w.text,
    start: w.s,
    end: w.e,
  }));

  const captionGroups: CaptionGroup[] = groupWordsIntoCaptions(words, 4);

  const segments: Segment[] = SEGMENT_TEXTS.map((seg) => ({
    id: uuid(),
    text: seg.text,
    start: seg.start,
    end: seg.end,
    words: words.slice(seg.from, seg.to),
  }));

  return {
    language: "en",
    duration: 40.0,
    segments,
    words,
    captionGroups,
  };
}
