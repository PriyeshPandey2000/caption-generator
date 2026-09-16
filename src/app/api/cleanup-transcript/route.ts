import { NextRequest, NextResponse } from "next/server";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TIMEOUT_MS = 20_000;
// Narrow, highly-constrained correction task — not creative generation — so a
// fast/cheap model is sufficient. Swap here if a real-sample run shows poorer
// cleanup quality than a larger model would deliver.
const CLEANUP_MODEL = "llama-3.3-70b-versatile";

// Every rule exists to keep the pass a strict 1:1, same-order substitution.
// Timestamps are positionally tied to the word array, so any merge/split/add/
// drop would desync every timestamp after the divergence point.
const SYSTEM_PROMPT = [
  "You are a transcript proofreader. You will be given a speech-to-text transcript as a numbered, ordered list of words.",
  "Fix ONLY genuine speech-recognition errors: garbled words, homophone swaps, and misheard proper nouns or names.",
  "Rules — non-negotiable:",
  "- Return EXACTLY the same number of words, in EXACTLY the same order as the input.",
  "- Never merge two words into one, split one word into two, add a word, or drop a word.",
  "- Never rephrase or paraphrase. If a word is already correct, keep it byte-for-byte identical.",
  "- Preserve attached punctuation (e.g. \",\" or \".\" on the word) and the original spelling/case style.",
  "- Respond with a single JSON object: {\"words\": [\"<word1>\", \"<word2>\", ...]}.",
].join("\n");

function buildPrompt(words: string[]): string {
  const list = words.map((w, i) => `${i + 1}. "${w}"`).join("\n");
  return `Correct the following ordered word list. Return exactly ${words.length} words.\n\n${list}`;
}

function errResponse(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

// Silent fail-open contract: null/failed responses are indistinguishable to
// the client's fail-safe from "keep the original transcript". The client
// re-checks length defensively, so even a bug here can't desync timestamps.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errResponse("Invalid JSON body");
  }

  const input = (body as { words?: unknown })?.words;
  if (!Array.isArray(input) || input.length === 0 || input.length > 4000) {
    return errResponse("'words' must be a non-empty array (max 4000)");
  }
  if (input.some((w) => typeof w !== "string" || w.trim() === "")) {
    return errResponse("'words' must contain only non-empty strings");
  }
  const words = (input as string[]).map((w) => w.trim());

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // No key to attempt cleanup with — fail open to the original transcript.
    return NextResponse.json({ words: null });
  }

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLEANUP_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(words) },
        ],
      }),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error("Cleanup pass rejected by Groq:", res.status);
      return NextResponse.json({ words: null });
    }

    const json = await res.json();
    const content: unknown = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return NextResponse.json({ words: null });

    let parsed: { words?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("Cleanup pass returned non-JSON:", content.slice(0, 200));
      return NextResponse.json({ words: null });
    }

    const corrected = parsed?.words;
    // Strict validation: same count, same order, all non-empty strings. Any
    // mismatch means the LLM rephrased/merged/split words — reject outright.
    if (
      !Array.isArray(corrected) ||
      corrected.length !== words.length ||
      corrected.some((w) => typeof w !== "string" || w.trim() === "")
    ) {
      console.error(
        `Cleanup pass returned ${Array.isArray(corrected) ? corrected.length : "non-array"} words for ${words.length} input words — rejecting.`
      );
      return NextResponse.json({ words: null });
    }

    return NextResponse.json({ words: corrected.map((w) => w.trim()) });
  } catch (error) {
    console.error("Cleanup pass failed:", error);
    return NextResponse.json({ words: null });
  }
}