import { Word, SfxEvent, SfxSettings, SfxPackId, SfxRole, SfxName, CameraEvent } from "./types";

export interface SfxPackMapping {
  punchline: SfxName | null;
  cameraPunch: SfxName | null;
  emphasis: SfxName | null;
  transition: SfxName | null;
}

const PACKS: Record<SfxPackId, SfxPackMapping> = {
  creator: {
    punchline: "hit",
    cameraPunch: "whoosh",
    emphasis: "pop",
    transition: "riser",
  },
  cinematic: {
    punchline: "thump",
    cameraPunch: "reverse-whoosh",
    emphasis: "soft-pop",
    transition: "riser",
  },
  clean: {
    punchline: null,
    cameraPunch: null,
    emphasis: "click",
    transition: null,
  },
  meme: {
    punchline: "bass-hit",
    cameraPunch: "whoosh",
    emphasis: "pop",
    transition: "record-scratch",
  },
};

// Deterministic PRNG (mulberry32) seeded by sfxSeed — same seed = same timeline.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function resolveSfx(role: SfxRole, pack: SfxPackId): SfxName | null {
  return PACKS[pack][role] ?? null;
}

export function sfxFile(name: SfxName): string {
  return `/sfx/${name}.mp3`;
}

export function densityThreshold(density: SfxSettings["density"]): number {
  switch (density) {
    case "off":
      return 0;
    case "subtle":
      return 0.1;
    case "balanced":
      return 0.25;
    case "energetic":
      return 0.4;
    case "chaotic":
      return 0.5;
  }
}

interface ScoredCandidate {
  word: Word;
  score: number;
  role: SfxRole;
}

// Score emphasis words by emphasis strength, punchline-ness (shorter word,
// later in a group), and synergy with an existing camera event. Higher = more
// likely to be kept when density culls.
function scoreCandidates(
  words: Word[],
  cameraEvents: CameraEvent[]
): ScoredCandidate[] {
  const cameraTimes = cameraEvents
    .map((e) => e.start + (e.peak - e.start) * 0.5)
    .sort((a, b) => a - b);

  const candidates: ScoredCandidate[] = [];

  for (const word of words) {
    if (!word.animation?.emphasis) continue;

    const emphasisStrength =
      word.animation.emphasis.scaleTo || 140;

    // Punchline heuristic: shorter words punctuate a phrase; normalize.
    const len = word.text.length;
    const punchlineScore = len <= 5 ? 1 : len <= 9 ? 0.6 : 0.3;

    // Camera synergy: 1 if a camera event lands on this word, else decay.
    const mid = (word.start + word.end) / 2;
    let cameraScore = 0;
    for (const ct of cameraTimes) {
      const d = Math.abs(ct - mid);
      if (d < 0.5) {
        cameraScore = Math.max(cameraScore, 1 - d);
      }
    }

    const score = emphasisStrength * 0.5 + punchlineScore * 0.3 + cameraScore * 0.2;

    // Pick the semantic role that dominates this word so the pack resolves the
    // matching sound (punchline/cameraPunch/emphasis) instead of always firing
    // the emphasis sound.
    const role: SfxRole =
      cameraScore >= 0.6
        ? "cameraPunch"
        : punchlineScore >= 1 && emphasisStrength >= 155
          ? "punchline"
          : "emphasis";

    candidates.push({ word, score, role });
  }

  return candidates;
}

// Cluster nearby emphasis words into a single reaction (e.g. "MOST IMPORTANT
// THING" → ONE combined hit), keeping the strongest of each cluster.
function clusterCandidates(
  candidates: ScoredCandidate[],
  windowSec: number
): ScoredCandidate[] {
  const sorted = [...candidates].sort((a, b) => a.word.start - b.word.start);
  const clusters: ScoredCandidate[][] = [];

  for (const cand of sorted) {
    const last = clusters[clusters.length - 1];
    const lastEnd = last ? last[last.length - 1].word.end : -Infinity;
    if (last && cand.word.start - lastEnd < windowSec) {
      last.push(cand);
    } else {
      clusters.push([cand]);
    }
  }

  return clusters.map((cluster) =>
    cluster.reduce((best, c) => (c.score > best.score ? c : best))
  );
}

export function buildSfxTimeline(
  words: Word[],
  settings: SfxSettings,
  cameraEvents: CameraEvent[],
  overrides: Record<string, "none" | SfxName> = {}
): SfxEvent[] {
  const events: SfxEvent[] = [];

  if (!settings.enabled || settings.density === "off") return events;

  const threshold = densityThreshold(settings.density);
  // Manually-decided words are always excluded from automatic generation.
  let candidates = scoreCandidates(words, cameraEvents).filter(
    (c) => !(c.word.id in overrides)
  );

  if (candidates.length === 0) return events;

  // Deterministic tiebreak + cull by density (top `threshold` fraction).
  const rand = mulberry32(settings.sfxSeed);
  candidates = candidates
    .map((c) => ({ ...c, jitter: rand() }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.word.text === b.word.text
          ? a.jitter - b.jitter
          : a.word.text.localeCompare(b.word.text))
    );

  const keepCount = Math.max(1, Math.round(candidates.length * threshold));
  candidates = candidates.slice(0, keepCount);

  // Cluster the survivors into single reactions.
  const clustered = clusterCandidates(candidates, 0.4);

  for (const cand of clustered) {
    const role = cand.role;
    const sound = resolveSfx(role, settings.pack);
    if (!sound) continue;

    const offsetSec = settings.offsetMs / 1000;

    events.push({
      id: `auto:${settings.sfxSeed}:${cand.word.id}:${role}:${sound}`,
      start: Math.max(0, cand.word.start + offsetSec),
      duration: Math.max(0.08, cand.word.end - cand.word.start),
      role,
      sound,
      volume: settings.volume === "quiet" ? 0.5 : settings.volume === "aggressive" ? 1 : 0.75,
      pitch: role === "punchline" ? 0.9 : 1,
      offsetMs: settings.offsetMs,
      source: "auto",
      sourceWordIds: [cand.word.id],
    });
  }

  return events.sort((a, b) => a.start - b.start);
}
