import { CameraEvent, VideoEffects, Word } from "./types";
import { v4 as uuid } from "uuid";

const DEFAULT_ANTICIPATION_MS = 100;

// Fallback-only: the minimum time between one punch's peak and the next
// word's start. Without this, "every word qualifies" means every word gets
// its own punch — on ordinary speech (2-4 words/sec) that's a zoom cycle
// every few hundred ms for the whole video: the frame never settles, it just
// pulses continuously at speech cadence. A real camera punch is an occasional
// beat (every couple of seconds), not a metronome. Explicit/curated
// emphasis lists are already sparse by construction and aren't gated by this.
const MIN_FALLBACK_GAP_SEC = 2.2;

// Camera zoom scales the frame around this fraction of its height instead of
// dead-center (0.5). On a standard talking-head frame the face sits above
// the geometric middle, so scaling around 0.5 grows the picture symmetrically
// around empty space (mostly torso/background) and reads as the whole frame
// "breathing" rather than a camera approaching the person. This isn't face
// tracking — there's no such data here — just a fixed bias toward where a
// head usually is. Shared with scene-renderer so the preview and the export
// scale around the same point.
export const ZOOM_ORIGIN_Y = 0.44;

export function buildCameraTimeline(
  words: Word[],
  emphasisWordIds: string[],
  videoEffects: VideoEffects
): CameraEvent[] {
  const events: CameraEvent[] = [];
  // No explicit emphasis anywhere -> drive the camera off every word instead
  // of silently producing zero events. Callers that already have emphasized
  // words pass them straight through; this only kicks in when the list is
  // empty, e.g. a choreography preset whose curated emphasis words don't
  // appear in this transcript.
  const emphasisSet = new Set(emphasisWordIds);
  const isFallback = emphasisSet.size === 0;

  const anticipationSec = DEFAULT_ANTICIPATION_MS / 1000;
  const inSec = videoEffects.inDuration / 1000;
  const outSec = videoEffects.outDuration / 1000;

  for (const word of words) {
    if (!isFallback && !emphasisSet.has(word.id)) continue;

    const anticipate = Math.max(0, word.start - anticipationSec);

    // In the fallback every word qualifies. The old guard here only skipped a
    // word whose envelope *overlapped* the previous one (anticipate <=
    // last.end) — envelopes are ~400-500ms, so on ordinary speech that still
    // let a new punch start every word or two: a continuous pulse, not an
    // occasional beat. Gate on MIN_FALLBACK_GAP_SEC from the previous punch's
    // *peak* (the actual beat moment) instead, so fallback punches land a
    // couple of seconds apart regardless of how tightly the words are packed.
    // Explicit/curated emphasis is sparse by construction and skips this gate
    // entirely — only the "no emphasis matched" fallback needed throttling.
    const last = events[events.length - 1];
    if (isFallback && last && word.start - last.peak < MIN_FALLBACK_GAP_SEC) continue;

    const holdStart = word.start + Math.min(inSec, (word.end - word.start) * 0.3);
    const releaseEnd = word.end + outSec;

    events.push({
      id: uuid(),
      start: anticipate,
      peak: holdStart,
      end: releaseEnd,
      type: "zoom",
      intensity: 1.0,
      source: "auto",
    });
  }

  return mergeOverlapping(events);
}

export function mergeOverlapping(events: CameraEvent[]): CameraEvent[] {
  if (events.length === 0) return [];

  // Copy before merging: the merge widens `last` in place, and callers pass
  // live objects out of the store, so mutating them would edit current state
  // behind the store's back and corrupt the undo baseline.
  const sorted = events
    .map((e) => ({ ...e }))
    .sort((a, b) => a.start - b.start);
  const merged: CameraEvent[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];

    if (curr.start <= last.end) {
      last.end = Math.max(last.end, curr.end);
      last.peak = Math.max(last.peak, curr.peak);
      last.intensity = Math.max(last.intensity, curr.intensity);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

export function sampleZoom(
  currentTime: number,
  events: CameraEvent[],
  videoEffects: VideoEffects
): number {
  const globalMax = videoEffects.maxScale;

  for (const event of events) {
    if (currentTime < event.start || currentTime > event.end) continue;

    const effectiveMax = 1 + (globalMax - 1) * event.intensity;

    // Phase 1: Anticipate → zoom-in (start to peak)
    //
    // easeOutCubic, not an overshoot easing. easeOutBack (c1 = 1.70158) is a
    // bounce: it accelerates past the target and springs back, which read on a
    // short word as a hard "zoom in and snap back" jolt. Cubic still lands
    // fast — the punch comes from the peak scale and the SFX, not from a
    // bounce — and it never exceeds the target, so the release below returns
    // to 1.0 as a pure decay with no visible direction change at the peak.
    if (currentTime <= event.peak) {
      const range = event.peak - event.start;
      if (range <= 0) return effectiveMax;
      const t = (currentTime - event.start) / range;
      return 1 + (effectiveMax - 1) * easeOutCubic(t);
    }

    // Phase 2: Hold at maxScale (peak to word.end)
    // We approximate hold end as midpoint between peak and event.end
    const wordEnd = event.peak + (event.end - event.peak) * 0.4;
    if (currentTime <= wordEnd) {
      return effectiveMax;
    }

    // Phase 3: Release (wordEnd to event.end)
    const range = event.end - wordEnd;
    if (range <= 0) return 1.0;
    const t = (currentTime - wordEnd) / range;
    return effectiveMax - (effectiveMax - 1) * easeOutCubic(t);
  }

  return 1.0;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Slider UI uses discrete levels 1–5; choreography bundles use a continuous
// 0–1 fraction. Both must land on the same maxScale ceiling (1.6 at full
// strength) or presets like MrBeast (intensity: 0.85) end up computing an
// almost-invisible zoom instead of the punchy one the preset promises.
export function sliderIntensityToScale(level: number): number {
  return 1.0 + level * 0.12;
}

export function fractionalIntensityToScale(fraction: number): number {
  return 1.0 + fraction * 0.6;
}
