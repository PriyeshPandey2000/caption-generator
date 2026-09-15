import { DictionaryEntry, Word } from "./types";

// Groq's Whisper endpoint caps the prompt at 224 tokens and rejects prompts
// over that. There's no tokenizer available client-side, so the budget is
// estimated at ~4 characters per token (a coarse BPE proxy for Whisper's
// GPT-2-style tokenizer) and terms are dropped from the tail at whole-term
// boundaries once the estimate is spent — a large dictionary degrades into a
// shorter hint instead of failing the request.
const WHISPER_PROMPT_MAX_TOKENS = 224;
const CHARS_PER_TOKEN = 4;

function estimatedPromptTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// A Word.text is always a single whitespace-free token (see
// parseSegmentsToWords), and grouping, timestamps, selection and export all
// treat a Word as one atomic unit. A multi-word mapping can therefore never
// match a word at apply time, and forcing a multi-word correction into a
// single Word would collapse several timestamps — so dictionary entries are
// single tokens. Anything else is rejected when added and skipped defensively
// here (a project saved before the validation could still hold one).
export function isSingleToken(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/\s/.test(trimmed);
}

export function buildWhisperPrompt(entries: DictionaryEntry[]): string {
  const terms = entries
    .map((e) => e.to.trim())
    .filter((t) => t && isSingleToken(t));
  if (terms.length === 0) return "";

  const picked: string[] = [];
  for (const term of terms) {
    const candidate = `Vocabulary: ${[...picked, term].join(", ")}.`;
    if (estimatedPromptTokens(candidate) > WHISPER_PROMPT_MAX_TOKENS) break;
    picked.push(term);
  }
  if (picked.length === 0) return "";
  return `Vocabulary: ${picked.join(", ")}.`;
}

// Strips leading/trailing punctuation so "Posters," matches a dictionary
// entry for "posters" the same way "posters" would.
function stripPunctuation(text: string): string {
  return text.replace(/^[^\w$]+|[^\w$]+$/g, "");
}

// Guaranteed find-replace pass over transcribed words. Case-insensitive,
// punctuation-insensitive match on the bare word; the correction keeps
// whatever leading/trailing punctuation Whisper attached (so "posters," ->
// "Postiz," not "Postiz").
export function applyDictionary(words: Word[], entries: DictionaryEntry[]): Word[] {
  if (entries.length === 0) return words;

  const lookup = new Map<string, string>();
  for (const e of entries) {
    // Defensive against persisted multi-word entries that slipped in before
    // the single-token validation — they can never match a Word.
    if (!isSingleToken(e.from) || !isSingleToken(e.to)) continue;
    const key = stripPunctuation(e.from).toLowerCase();
    if (key) lookup.set(key, e.to);
  }
  if (lookup.size === 0) return words;

  return words.map((w) => {
    const bare = stripPunctuation(w.text);
    const correction = lookup.get(bare.toLowerCase());
    if (!correction || bare === correction) return w;

    const leading = w.text.slice(0, w.text.indexOf(bare));
    const trailing = w.text.slice(w.text.indexOf(bare) + bare.length);
    return { ...w, text: `${leading}${correction}${trailing}` };
  });
}
