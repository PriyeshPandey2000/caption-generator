import { DictionaryEntry, Word } from "./types";

// Groq's Whisper endpoint caps the prompt at 224 tokens and only treats it as
// a soft vocabulary/spelling hint, not a guaranteed substitution — so this is
// paired with applyDictionary below, which does the guaranteed part.
export function buildWhisperPrompt(entries: DictionaryEntry[]): string {
  const terms = entries.map((e) => e.to.trim()).filter(Boolean);
  if (terms.length === 0) return "";
  return `Vocabulary: ${terms.join(", ")}.`;
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
