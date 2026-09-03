import { SfxEvent } from "./types";
import { sfxFile } from "./sfx";

// Singleton audio graph for SFX. One AudioContext, created + resumed on the
// first user Play (browser autoplay rules), video routed through its own Gain
// node so ducking lowers the voice instead of mutating <video>.volume.
const LOOK_AHEAD_S = 1.2; // schedule this far ahead of the current time
const BUFFER_S = 0.12; // keep at least 120ms of scheduled time in the bank

// Track every live source so clearScheduled() can stop() it (a scheduled
// AudioBufferSourceNode starts at a future time and won't die on its own).
type NodeWithTime = {
  eventStart: number;
  duration: number;
  node: AudioBufferSourceNode;
};

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private sourceConn: MediaElementAudioSourceNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private preloadPromise: Promise<void> | null = null;
  private events: SfxEvent[] = [];
  private scheduled: NodeWithTime[] = [];
  private lastScheduledThrough = 0;
  private lastVideoTime = 0;
  private running = false;
  // Bumped whenever the event list is replaced so a stale loadBuffer retry
  // can't fire a source for an event that no longer exists.
  private eventsGeneration = 0;

  ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.voiceGain = this.ctx.createGain();
      this.voiceGain.gain.value = 1;
      this.voiceGain.connect(this.master);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  // Route the video's audio through the graph for ducking. Safe to call
  // repeatedly with the same element. For local uploads this is same-origin,
  // which avoids MediaElementSource cross-origin restrictions.
  attachVideo(video: HTMLVideoElement): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.voiceGain) return;
    if (this.sourceConn && this.sourceConn.mediaElement === video) return;
    try {
      this.sourceConn = ctx.createMediaElementSource(video);
      this.sourceConn.connect(this.voiceGain);
      this.master?.connect(ctx.destination);
    } catch {
      // not allowed (e.g. cross-origin) — fall back to ducking disabled
      this.sourceConn = null;
    }
  }

  setEvents(events: SfxEvent[]): void {
    this.events = events;
    this.eventsGeneration++;
    this.clearScheduled();
  }

  // Toggle the scheduler on/off. This is driven from the caller's RAF tick
  // (it calls scheduleAhead); it does NOT spawn its own loop.
  setRunning(running: boolean): void {
    this.running = running;
    if (!running) this.clearScheduled();
  }

  // Schedule all SFX whose video-time start falls within the next look-ahead
  // window, advancing the scheduling frontier. `currentVideoTime` is the
  // source of truth; AudioContext.currentTime is the scheduling clock.
  scheduleAhead(currentVideoTime: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    this.lastVideoTime = currentVideoTime;

    // After a clearScheduled the frontier resets to 0; rebase it forward so a
    // resume/seek can't re-fire events that have already elapsed.
    if (this.lastScheduledThrough < currentVideoTime) {
      this.lastScheduledThrough = currentVideoTime;
    }
    const horizon = currentVideoTime + LOOK_AHEAD_S;

    for (const ev of this.events) {
      if (ev.start < this.lastScheduledThrough) continue;
      if (ev.start > horizon) continue;
      this.play(ev);
      this.lastScheduledThrough = Math.max(this.lastScheduledThrough, ev.start + 0.05);
    }

    // Prune finished nodes from the tracking list.
    this.scheduled = this.scheduled.filter(
      (n) => n.eventStart + n.duration > ctx.currentTime + BUFFER_S
    );
  }

  // Play a single event. `when` is derived from how far the event's video time
  // is ahead of the current video time, translated into AudioContext time.
  play(ev: SfxEvent): boolean {
    if (!this.ctx || !this.buffersReady) return false;
    if (!this.buffers.has(ev.sound)) {
      const generation = this.eventsGeneration;
      void this.loadBuffer(ev.sound).then(() => {
        if (this.running && this.eventsGeneration === generation) this.play(ev);
      });
      return false;
    }
    const buffer = this.buffers.get(ev.sound);
    if (!buffer) return false;

    const ctx = this.ctx;
    const nowCtx = ctx.currentTime;
    const when = Math.max(nowCtx + 0.02, nowCtx + (ev.start - this.lastVideoTime));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = ev.pitch ?? 1;

    const gain = ctx.createGain();
    const v = ev.volume ?? 0.75;
    // tiny envelope to avoid clicks
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(v, when + 0.005);
    gain.gain.setValueAtTime(v, when + (buffer.duration || 0.2) - 0.02);
    gain.gain.linearRampToValueAtTime(0, when + (buffer.duration || 0.2));

    if (!this.master) return false;
    src.connect(gain);
    gain.connect(this.master);
    // Duck the voice from the SAME time the SFX fires, so the look-ahead
    // window doesn't return the voice to full volume before the sound starts.
    this.dimVoice(when, ev.duration || 0.2);
    src.start(when);
    this.scheduled.push({
      eventStart: ev.start,
      duration: buffer.duration || 0.2,
      node: src,
    });
    return true;
  }

  // Brief duck on the voice gain so speech stays audible over the SFX.
  private dimVoice(when: number, durationS: number): void {
    if (!this.ctx || !this.voiceGain) return;
    const g = this.voiceGain.gain;
    g.cancelScheduledValues(when);
    g.setValueAtTime(1, when);
    g.linearRampToValueAtTime(0.6, when + 0.02);
    g.setValueAtTime(0.6, when + durationS);
    g.linearRampToValueAtTime(1, when + durationS + 0.1);
  }

  clearScheduled(): void {
    for (const s of this.scheduled) {
      try {
        s.node.stop();
      } catch {
        // already stopped or never started — ignore
      }
    }
    this.scheduled = [];
    this.lastScheduledThrough = 0;
  }

  get buffersReady(): boolean {
    return this.preloadPromise != null;
  }

  preload(names: SfxEvent["sound"][]): void {
    const missing = names.filter((n) => !this.buffers.has(n));
    if (missing.length === 0) return;
    this.preloadPromise = Promise.all(
      missing.map((n) => this.loadBuffer(n))
    ).then(() => undefined) as Promise<void>;
  }

  private async loadBuffer(name: SfxEvent["sound"]): Promise<void> {
    if (!this.ctx || this.buffers.has(name)) return;
    const url = sfxFile(name);
    try {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      this.buffers.set(name, buf);
    } catch {
      // missing/unplayable sound — skip
    }
  }

  dispose(): void {
    this.clearScheduled();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.voiceGain = null;
    this.buffers.clear();
  }
}

export const sfxEngine = new SfxEngine();
