import { Word, CaptionGroup, Segment } from "./types";
import { v4 as uuid } from "uuid";

export function groupWordsIntoCaptions(
  words: Word[],
  maxWordsPerGroup: number = 4
): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let currentWords: Word[] = [];

  for (const word of words) {
    currentWords.push(word);

    const isNewLine =
      currentWords.length >= maxWordsPerGroup ||
      (currentWords.length > 1 &&
        word.end - currentWords[0].start > 3.0);

    const isLastWord = word === words[words.length - 1];

    if (isNewLine || isLastWord) {
      groups.push({
        id: uuid(),
        wordIds: currentWords.map((w) => w.id),
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
        speaker: currentWords[0].speaker,
      });
      currentWords = [];
    }
  }

  return groups;
}

export function parseSegmentsToWords(
  segments: Array<{
    text: string;
    start: number;
    end: number;
    words?: Array<{ word: string; start: number; end: number }>;
  }>,
  // Groq's verbose_json returns a top-level `words` array with real per-word
  // timestamps (we always request word granularity) — this is the primary
  // timing source. Segments are used only for text groupings.
  wordTimings?: Array<{ word: string; start: number; end: number }>
): { words: Word[]; parsedSegments: Segment[] } {
  const parsedSegments: Segment[] = segments.map((seg) => ({
    id: uuid(),
    text: seg.text,
    start: seg.start,
    end: seg.end,
    words: [],
  }));

  // Primary path: Whisper's word-level timestamps. These are authoritative —
  // the even-split fallback below gives "a" and "internationally" the same
  // on-screen duration regardless of real cadence. Attribution walks both
  // arrays in order (words and segments are chronological), so gaps between
  // segments are handled and ordering is never scrambled.
  if (wordTimings && wordTimings.length > 0) {
    const words: Word[] = wordTimings.map((w) => ({
      id: uuid(),
      text: w.word.trim(),
      start: w.start,
      end: w.end,
    }));
    let segIdx = 0;
    for (const word of words) {
      while (
        segIdx < parsedSegments.length - 1 &&
        word.start >= parsedSegments[segIdx + 1].start
      ) {
        segIdx++;
      }
      parsedSegments[segIdx].words.push(word);
    }
    return { words, parsedSegments };
  }

  // Fallback (no word-level timestamps returned): derive words from segment
  // text. Nested per-segment words if the provider supplies them, else
  // evenly split each segment's duration across its tokens.
  const allWords: Word[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg.words && seg.words.length > 0) {
      for (const w of seg.words) {
        const word: Word = {
          id: uuid(),
          text: w.word.trim(),
          start: w.start,
          end: w.end,
        };
        parsedSegments[i].words.push(word);
        allWords.push(word);
      }
    } else {
      const tokens = seg.text.split(/\s+/).filter(Boolean);
      const duration = seg.end - seg.start;
      const tokenDuration = duration / tokens.length;

      for (let t = 0; t < tokens.length; t++) {
        const word: Word = {
          id: uuid(),
          text: tokens[t],
          start: seg.start + t * tokenDuration,
          end: seg.start + (t + 1) * tokenDuration,
        };
        parsedSegments[i].words.push(word);
        allWords.push(word);
      }
    }
  }

  return { words: allWords, parsedSegments };
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

export function wordsToSRT(words: Word[], groupSize: number = 4): string {
  const groups: Word[][] = [];
  let current: Word[] = [];

  for (const word of words) {
    current.push(word);
    if (current.length >= groupSize) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  return groups
    .map((group, i) => {
      const start = formatSRTTime(group[0].start);
      const end = formatSRTTime(group[group.length - 1].end);
      const text = group.map((w) => w.text).join(" ");
      return `${i + 1}\n${start} --> ${end}\n${text}`;
    })
    .join("\n\n");
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}
