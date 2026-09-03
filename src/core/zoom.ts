import { CameraEvent, VideoEffects, Word } from "./types";
import { v4 as uuid } from "uuid";

const DEFAULT_ANTICIPATION_MS = 100;

export function buildCameraTimeline(
  words: Word[],
  emphasisWordIds: string[],
  videoEffects: VideoEffects
): CameraEvent[] {
  const events: CameraEvent[] = [];
  const emphasisSet = new Set(emphasisWordIds);

  for (const word of words) {
    if (!emphasisSet.has(word.id)) continue;

    const anticipationSec = DEFAULT_ANTICIPATION_MS / 1000;
    const inSec = videoEffects.inDuration / 1000;
    const outSec = videoEffects.outDuration / 1000;

    const anticipate = Math.max(0, word.start - anticipationSec);
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

  const sorted = [...events].sort((a, b) => a.start - b.start);
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
    if (currentTime <= event.peak) {
      const range = event.peak - event.start;
      if (range <= 0) return effectiveMax;
      const t = (currentTime - event.start) / range;
      return 1 + (effectiveMax - 1) * easeOutBack(t);
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

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Slider UI uses discrete levels 1–5; choreography bundles use a continuous
// 0–1 fraction. Both must land on the same maxScale ceiling (1.6 at full
// strength) or presets like MrBeast (intensity: 0.7) end up computing an
// almost-invisible zoom instead of the punchy one the preset promises.
export function sliderIntensityToScale(level: number): number {
  return 1.0 + level * 0.12;
}

export function fractionalIntensityToScale(fraction: number): number {
  return 1.0 + fraction * 0.6;
}
