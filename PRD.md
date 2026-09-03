# PRD — "Turn speech into animated typography"

**Working title:** `CaptionLab`
**Competition:** Build Games — Best Replacement / Most Creative / Most Polished
**Submission surface:** a **public web app URL** + public repo. The URL is what judges open — **the web app IS the deliverable.** (Code stays portable so a Tauri desktop wrap is a later, cheap option — not a demo requirement.)

---

## 1. One-line pitch

> The programmable caption + auto-zoom editor for short-form video: **every aspect customisable, but you never have to customise anything.**

## 2. Why a user cancels a subscription

One upload → styled, animated, corrected, zoomed, **exported short** in ≤2 minutes — the job Submagic / CapCut / SubtitleEdit charge for piecemeal, done in one place, **entirely in the browser (footage never leaves the machine — privacy as a feature).**

## 3. Elevator demo (the 2-minute judge test)

1. Drop a clip → **styled captions appear in seconds** (word-aligned, tasteful default). *instant wow*
2. **Drag a caption, scale it → "big type"**, scrub the timeline. *a real editor, not a form*
3. One click: "Make it MrBeast-style" → punchlines pop, auto-zoom, SFX sync. *agentic*
4. One click: **Export MP4 + SRT.** *complete replacement loop*

---

## 4. Principles (rules everything follows)

- **Speed-to-beautiful first** — first result gorgeous and instant; depth discovered progressively.
- **Word is the atomic unit** — captions are *views over words*. All power flows from this.
- **Inheritance over chaos** — Global → Speaker → Phrase → Word; every control optional; every override resettable.
- **Editor is the product, export is the closing** — don't gold-plate export; gold-plate interaction.
- **Browser-first, portable core** — engine in plain TS, no DOM coupling.
- **Advanced = optional** — a judge gets a great result without touching settings.

---

## 5. Locked foundation (confirmed)

- **Transcription:** Groq `whisper-large-v3-turbo` → `response_format: "verbose_json"`, `timestamp_granularities: ["word","segment"]`. Gives `{word, start, end}` per word + segment metadata. Free-tier friendly, fast.
- **Word timestamps: ✅ confirmed. Speaker labels: Phase 2 / optional diarization layer** (Groq does NOT emit speaker labels) — not a Phase-1 blocker.
- **Burn-in:** `ffmpeg.wasm` in-browser, short-form 1080p. No backend needed for the demo. Export seam allows a server-side FFmpeg / Tauri drop-in later.
- **Stack:** Next.js (UI) + thin Node routes (proxy Groq key) + ffmpeg.wasm.

---

# PHASE 1 — CORE (the demo lives/dies here; ship polished, not broad)

### 1.1 Upload → instant styled result

- Drag/drop, paste, or pick file.
- Auto-detect language + speaker boundaries.
- **One upload → styled captions in seconds**; no blank screen, no required settings.
- Runs on Groq word+segment timestamps.

### 1.2 Word-level model + hierarchy

- `Word` = `{ id, text, start, end, speaker?, style?, transform?, animation? }`.
- `CaptionGroup` = a view over a run of words (grouping, not a separate store).
- Resolution: **Global → Speaker → Phrase → Word** (lowest wins).
- Inspector shows "inherited from" chain + **Reset to Global**.
- All in a plain-TS, unit-testable, framework-agnostic core module.

### 1.3 Direct manipulation on preview

- **Click → drag** to reposition (respect safe areas).
- **Corners/edges → scale** ("make it big type").
- **Timeline:** click to seek; **drag edges to retime**; click transcript word → playhead moves there.
- Live preview, real-time (no render-to-see).

### 1.4 Animation recipes, Style vs Motion split

- **Style:** font, size, color, stroke, shadow, background, case, position, max-width/wrap, safe-area.
- **Motion:** entrance, active-word, exit, emphasis, transitions, timing, easing.
- **Recipes** = one-click presets, fully parameter-editable:
  - entrance `scale 80→110→100 / 180ms / easeOutBack`
  - active-word `scale 100→125, yellow, glow 20%`
  - exit `opacity 100→0 / 120ms`
- **Recipe-level size/zoom keyframes** for the "120→180→120 while spoken" punchline case (no full keyframe editor yet).

### 1.5 AI choreography (the agentic differentiator)

- AI reads transcript → **visual script**: emphasis words, punchlines, jokes, questions, speaker changes → proposed styling.
- User can **edit the AI's decisions**.
- Thin **natural-language layer**: "make it high-energy MrBeast short" → curated parameter bundle.

### 1.6 Presets, templates, brand kit

- **Templates** = Style + Animation + Layout mix, one-click.
- **Brand kit:** 2–3 colors + default font, applied everywhere.
- Saved locally (localStorage).

### 1.7 Export (the closing action)

- **Burn-in MP4** via ffmpeg.wasm; **SRT/VTT**; **project save/load**.
- Resolution/bitrate/duration **caps** to prevent browser freeze.
- Clean seam for server-side FFmpeg / Tauri later.

---

# PHASE 2 — VIRAL VIDEO MANIPULATION (differentiators; scoped, demo-able)

- **Auto-zoom:** on energy/punchline/volume spikes → 1.1–1.2× slow push or cut; + manual "add zoom". (Scale keyframes on the video wrapper.)
- **Auto-SFX:** subtle whoosh/pop synced to emphasis/emoji (prebaked cue library).
- **Audio-event tagging:** detect/stylize `[laughter]`, `[applause]`.
- **Speaker-aware styling:** colorful per-speaker split (needs the diarization layer).

---

# PHASE 3 — SCALE-UP (only if time allows; nothing blocks the win)

- **Server-side FFmpeg** burn-in (Fly/Railway) — 4K/long, web-scale.
- **Tauri desktop wrap** — native speed + HW accel + offline + file access (post-competition).
- **Contextual B-roll injection** — high-value nouns → 1.5s overlays (stock API + licensing; **riskiest**, opt-in).
- **True ripple / dead-air edit** of source (risky for lip-sync; **text-only filler strip** is safe default).
- **Style remix / "Surprise Me"** randomizer (garnish).
- **Auto-layout typography** engine (optical centering, line balancing).
