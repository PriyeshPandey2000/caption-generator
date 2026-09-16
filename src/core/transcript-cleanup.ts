import { Word } from "./types";

const CLEANUP_ENDPOINT = "/api/cleanup-transcript";

// Contextual second-pass cleanup for one-off ASR errors (garbled words,
// homophone swaps, misheard proper nouns). The user dictionary (dictionary.ts)
// only fixes pre-taught, recurring mishears; this catches the rest generically,
// the way a human proofreader would.
//
// Runs after Whisper + word-level timing, before the user dictionary, which
// must override anything the LLM decides — user intent is the final word.
//
// Always-on, but fully fail-open: any failure (network, empty response, a
// rejected word count) surfaces the original transcript untouched so a bad
// cleanup can never block or corrupt it. The strict 1:1 word-count guarantee
// is enforced here AND on the server because word timestamps are positionally
// tied to the word array — any merged/split/added/dropped word would desync
// every timestamp after the divergence point.
export async function applyTranscriptCleanup(words: Word[]): Promise<Word[]> {
  if (words.length === 0) return words;

  let corrected: string[];
  try {
    const res = await fetch(CLEANUP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words: words.map((w) => w.text) }),
    });
    const data = (await res.json().catch(() => null)) as { words?: unknown } | null;
    if (!res.ok || !data || !Array.isArray(data.words)) return words;
    corrected = data.words as string[];
  } catch {
    return words;
  }

  if (corrected.length !== words.length) return words;
  if (corrected.some((w) => typeof w !== "string" || w.trim() === "")) return words;

  return words.map((w, i) => ({ ...w, text: corrected[i].trim() }));
}