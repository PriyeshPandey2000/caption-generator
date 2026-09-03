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
  }>
): { words: Word[]; parsedSegments: Segment[] } {
  const allWords: Word[] = [];
  const parsedSegments: Segment[] = [];

  for (const seg of segments) {
    const segWords: Word[] = [];

    if (seg.words && seg.words.length > 0) {
      for (const w of seg.words) {
        const word: Word = {
          id: uuid(),
          text: w.word.trim(),
          start: w.start,
          end: w.end,
        };
        segWords.push(word);
        allWords.push(word);
      }
    } else {
      const tokens = seg.text.split(/\s+/).filter(Boolean);
      const duration = seg.end - seg.start;
      const tokenDuration = duration / tokens.length;

      for (let i = 0; i < tokens.length; i++) {
        const word: Word = {
          id: uuid(),
          text: tokens[i],
          start: seg.start + i * tokenDuration,
          end: seg.start + (i + 1) * tokenDuration,
        };
        segWords.push(word);
        allWords.push(word);
      }
    }

    parsedSegments.push({
      id: uuid(),
      text: seg.text,
      start: seg.start,
      end: seg.end,
      words: segWords,
    });
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
