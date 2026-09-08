# Development Log — CaptionLab

Chronological record of what has been built and every decision taken, so progress and rationale are never lost.

---

## 2026-09-03 — Bootstrapping & Phase 1 Core

### Session goal
Get from empty repo to a working, polished Phase 1 editor that a judge can demo without needing a Groq API key.

### Repo setup
- Initialized git repo, set the upstream remote to `https://github.com/PriyeshPandey2000/caption-generator.git`.
- Scafolded a fresh Next.js 16 app (`create-next-app`): TypeScript + Tailwind v4 + App Router, `src/` directory.
- Installed: `zustand` (state), `uuid`, `@ffmpeg/ffmpeg` + `@ffmpeg/util` (burn-in).

### Locked architecture decisions
- **Next.js 16 with Turbopack** is the build default. The initial `webpack` config in `next.config.ts` broke the build — replaced with an empty `turbopack: {}` config. (Heed Next.js 16's "this is not the Next.js you know" rules — API/filename conventions differ from older training data.)
- **Plain-TS engine module** (`src/core/`) is framework-agnostic and unit-testable, per the PRD's "Browser-first, portable core" principle. UI lives in `src/components/`, state in a single `zustand` store (`src/store/editor-store.ts`).

### Core data model (Phase 1.2)
- `Word = { id, text, start, end, speaker?, style?, transform?, animation? }` — the atomic unit.
- `CaptionGroup` = a view over a run of words (a "line"), **not** a separate store. Groups are derived by `groupWordsIntoCaptions` (configurable words-per-line, default 4).
- Resolution order **Global → Speaker → Phrase → Word** implemented in `src/core/styles.ts` via `resolveWordStyle` / `resolveWordMotion` / `resolveWordTransform`. Word (lowest level) wins.
- Store exposes full override API: `updateWordStyle/Motion/Transform`, `resetWordStyle/Motion`, speaker + global updaters, `retimeWord`, `regroupCaptions`, `setMaxWordsPerGroup`, `applyPreset`.

### Transcription (Phase 1.1)
- `/api/transcribe` route POSTs the user's file + their Groq key to `whisper-large-v3-turbo` with `response_format: verbose_json` and `timestamp_granularities: [word, segment]`.
- Key is proxied through a thin server route so it never needs to be exposed client-side to third parties (still held locally in `localStorage`).
- Groq emits per-word `{word, start, end}` — parsed into `Word[]`; segments preserved. Words fall back to even-divided segment timing if per-word data is missing.

### Demo mode (key demo decision)
- **Decision:** The app must demo without an API key. Added `createDemoTranscription()` (`src/core/demo.ts`) — a sample 38-word captionated script used by the **"Try it with sample captions →"** button. In demo mode a black canvas stands in for the video and a `useDemoPlayback` RAF loop advances `currentTime` when "Play" is hit.
- This turns the 2-minute judge test into a zero-config path: open URL → click demo → captions animate instantly.

### Caption preview + recipes (Phases 1.3/1.4)
- `CaptionOverlay` renders the active caption group (words for the current time range) as styled words over the video.
- **Style vs Motion split** honored: style drives font/size/color/stroke/shadow/case; motion drives entrance / active-word / exit / emphasis animations.
- Recipes implemented: entrance `scale 80→100`, active-word `scale→125` + gold + optional glow, exit `fade`, emphasis `scale→140` + gold + glow (used for punchlines).
- Defaults chosen to be tasteful on first load (white, uppercase, black stroke, bottom-aligned via transform-y safe-area).

### Direct manipulation (Phase 1.3)
- **Click a caption group → drag** repositions it (per-group offset stored in `groupLayouts`, applied as a transform on the group wrapper).
- **Scale handle** (bottom-right) grows the group — "make it big type."
- Word click selects that word; Cmd/Ctrl-click multi-selects. Selected words show a blue ring.

### Inspector + inheritance (Phase 1.2/1.3)
- Right panel (`Inspector`) shows Global Style + Global Motion sliders/color/selects when nothing is selected, and per-word overrides when a word is selected, with a **Reset** button that clears word-level overrides back to Global.
- "Words per line" control (2–6) re-groups captions live.

### Presets & templates (Phase 1.6)
- `Presets` panel: Clean, MrBeast, Neon, Editorial, Punchy, Minimal — each a Style + Motion bundle applied in one click.
- Global style/motion are editable live from the Inspector.

### AI choreography (Phase 1.5 — agentic differentiator)
- `src/core/choreography.ts` maps natural language ("MrBeast", "high-energy/hype", "clean/minimal", "cinematic/film", "comedy/funny", "neon/cyberpunk", "calm/chill") → curated parameter bundles (global style + motion) **and** an emphasis-words list.
- `applyChoreography` in the store applies the bundle and tags matching transcript words with an `emphasis` recipe (bigger, gold, glow) so punchlines pop when spoken.
- UI: a text input + one-click suggestion chips ("MrBeast", "Clean", "Cinematic", "Comedy", "Neon", "Calm").

### Export (Phase 1.7)
- **SRT / VTT** one-click downloads built from word timing (`wordsToSRT`).
- **MP4 burn-in** via `@ffmpeg/ffmpeg`: loads wasm in-browser, writes the video + generated `.srt`, runs `subtitles=` filter, downloads the result. Served from a CDN bundle loader / dynamic import to keep the initial route light.

### Verified in the live browser
- Upload screen renders; API key saved to localStorage.
- Demo mode loads; captions animate and the **active spoken word turns gold and scales up** while upcoming words start at entrance scale.
- MrBeast AI choreography applied live: font → Impact/Arial Black, size → 64px, active word 1.35× gold, 4px gold stroke.
- Capture fixed a bug where `WordSpan` self-closed without rendering `{word.text}` (captions were styled but invisible).

### Project save/load (Phase 1.7) — completed
- **Decision:** autosave the project to localStorage, debounced 300ms, triggered on any change to `project` or `groupLayouts`. No manual "Save" button needed (simplest, best UX).
- New `src/core/persistence.ts`: framework-agnostic `saveProjectToStorage` / `loadProjectFromStorage` / `clearProjectFromStorage` under key `captionlab_project_v1`.
- Persisted: `transcription`, `globalStyle`, `speakerStyles`, `speakerMotions`, `groupLayouts` (+ `savedAt`).
- **Deliberately NOT persisted:** the source video blob/URL and `videoFile`. `videoUrl` is an ephemeral `blob:` URL and the `File` is binary — too large / not meaningful across reloads. On restore, a project renders on the black demo canvas (captions + styling intact), which is the correct behavior for a caption editor.
- Store gained `restorePersisted` (applies persisted data + resets playhead/selection) and `newProject` (fresh project + clears storage).
- `Editor` auto-restores a saved project on mount when one exists, and the header gained a **"New Project"** button that clears storage and resets.
- Wired `useEditorStore.subscribe` for autosave (browser-only, guarded).
- Verified in browser: applying MrBeast persisted Impact font + 38 words; page reload auto-restored the project (counter + black canvas back); New Project cleared storage + returned to upload screen. Lint + build pass.

### Polish pass (first-pass) — completed
- **Fixed emphasis animation bug** in `CaptionOverlay`: an emphasized/punchline word set `transform: scale(140%) scale(125%)` — multiplying two scales (≈175%) and skipping the entrance animation. Now it's a single clean `scale(140%)` + gold + glow.
- **Keyboard shortcuts:** press `Space` to play/pause (demo mode only, ignored while typing in inputs), and `Delete`/`Backspace` to reset the selected word's style/motion overrides back to Global.
- **Landing empty-state polish:** added a hero ("Turn speech into animated typography") + a 4-point feature list + the upload zone + demo button, so a judge immediately understands the value proposition before doing anything.
- **Discovery hint:** demo view shows "Space = play · drag a caption to move · drag the corner to scale · Del = reset style".
- Verified live: landing hero + bullets render after "New Project"; `Space` toggles the play button between "Play"/"Pause" (simulated keydown since the browser-press tool errored in this session); hint line renders.

### MP4 export caps — verified (uncommitted work kept)
- The working tree contains export-caps changes to `ExportPanel.tsx` (not yet committed): `MAX_EXPORT_DURATION_SEC = 90`, `MAX_EXPORT_WIDTH = 1280`, a `getVideoMetadata()` helper that reads real duration/dimensions from the source video, an early reject for videos over 90s, an aspect-preserving `scale` filter when width exceeds 1280, and bounded encode settings (`-preset ultrafast`, `-b:v 2500k`, `-maxrate 3000k`, `-bufsize 6000k`, `-c:a aac 128k`).
- **Verified end-to-end in the browser:** generated a real 1280×720 6s clip with audio (via homebrew ffmpeg), injected it into the store alongside the demo transcription, and clicked **Export MP4**. The full pipeline ran clean to **DONE**: ffmpeg.wasm initialised, video + SRT written, `subtitles=` burn-in executed with the caps, `output.mp4` produced, and the download fired.
- Note: a redundant always-present `-t 90` is passed even for short clips — harmless because >90s clips are rejected earlier (no trimming needed). Left intact as a safety net.
- Temporary test seams (`window.__captionlab`, `window.__exportStatus`, a `public/testclip.mp4`) were added to drive the in-browser upload/export and **fully removed** afterward. Working tree now differs from HEAD only by the intended export-caps change.

### Caption text editing — completed (Phase 1 gap: PRD "corrected")
- **Feature:** you can now edit the actual text of any transcribed word, which was the missing piece behind the PRD's "styled, animated, **corrected**, zoomed" value-prop line.
- Store: added `updateWordText(wordId, text)` — trims input and guards against emptying a word (falls back to the original text), updates `Word.text` in the transcription.
- New reusable component `src/components/EditableWord.tsx`: renders the word as a span styled by the resolved style; **double-click** swaps it to a transparent input (autofocus + select-all); **Enter** or **blur** commits via `onCommit`, **Escape** cancels. In edit mode it stops propagation so it never triggers group drag.
- Wired into **CaptionOverlay** (words over the video, matched to their resolved font/size/color/stroke so the edit field looks seamless) and **Timeline** (transcript word chips near the current time).
- Because export (SRT/VTT/MP4 burn) reads `Word.text`, edits propagate automatically; grouping is by word id so caption groups stay intact. Autosave persists edited text.
- **Verified:** lint clean, `next build` green (TypeScript compiles across all three wiring sites). Not yet browser-interacted but fully compiled and wired.

### Known issue / in progress
- **Demo playback speed** appeared ~8× too fast during a long dev session, caused by overlapping RAF loops accumulating across HMR reloads of the same page. A single-loop guard (module-scoped ownership in `useDemoPlayback.ts`) has been added — on a **fresh load** the loop count is exactly 1; the guard self-cancels any duplicate loop a re-mount/StrictMode might create. Final browser timing verification still to run.

### Remaining (next sessions)
- Finish/verify the in-flight neon-green visual redesign (UploadZone + hero font still pending) and confirm playback timing post-guard.
- Browser-verify camera zoom with a real uploaded video (demo mode has no video element).
- Auto-SFX (Phase 2.2), audio-event tagging, speaker-aware styling.
- Further polish (mobile layout audit, more presets, undo/redo).

---

## 2026-09-03 — Phase 2: Camera Layer (Auto-Zoom)

### Session goal
Implement AI-directed camera choreography: video-level zoom on emphasis words, driven by a camera event timeline and rendered via RAF on the `<video>` wrapper.

### What was built
- **Types** (`src/core/types.ts`): `CameraEvent` (`{ id, start, peak, end, type, intensity, source }`), `VideoEffects` (`{ cameraEvents, maxScale, inDuration, outDuration }`), added `videoEffects` to `GlobalStyle`.
- **Zoom engine** (`src/core/zoom.ts` — new file):
  - `buildCameraTimeline`: generates `CameraEvent[]` from emphasis words, using a three-phase envelope: anticipate (100ms before word) → zoom-in (150ms) → hold (through word duration) → release (300ms after word end).
  - `mergeOverlapping`: merges overlapping events so close emphasis words don't fight.
  - `sampleZoom`: frame-accurate sampling. Computes `effectiveMax = 1 + (globalMax - 1) * event.intensity`, so per-word Camera Punch (Subtle/Punch/Heavy) produces visually distinct zoom. Uses `easeOutBack` for the zoom-in "punch" feel and `easeOutCubic` for the release.
- **VideoPreview** (`src/components/VideoPreview.tsx`): RAF-driven zoom on a `<div>` wrapper around `<video>`. No CSS transitions — pure frame-driven interpolation. Snap to 1.0 when paused/scrubbing. Only active when `cameraEvents.length > 0`.
- **Presets panel** (`src/components/Presets.tsx`): Camera Movement toggle (on/off) + intensity slider (1–5, maps to `maxScale`). Shows event count + max scale.
- **Inspector** (`src/components/Inspector.tsx`): "Camera Punch" per selected word — None / Subtle / Punch / Heavy buttons. Sets per-event `intensity` (0–1 fractional). Manual events merge into the timeline via `mergeOverlapping`.
- **Choreography** (`src/core/choreography.ts`): Each bundle has `cameraMovement: { enabled, intensity }`. MrBeast (0.7), High-Energy (0.5), Comedy (0.3) auto-enable; Clean/Calm/Neon/Cinematic auto-disable. `applyChoreography` generates camera events from emphasis words when enabled.
- **Store** (`src/store/editor-store.ts`): `toggleCameraMovement` (always rebuilds on enable), `setCameraIntensity` (sets `maxScale` only, preserves per-event intensity), `addManualCameraEvent` (adds a manual event and merges).
- **Persistence**: `videoEffects` is part of `GlobalStyle`, so it saves/loads via existing autosave automatically.

### Bug fixes applied (6 issues caught in review)
1. **`event.intensity` was dead** — `sampleZoom` only used global `maxScale`, never read per-event `intensity`. Inspector's Subtle/Punch/Heavy buttons had no visual effect. Fixed: `sampleZoom` now computes `effectiveMax = 1 + (globalMax - 1) * event.intensity`.
2. **`toggleCameraMovement` stale-events guard** — `if (ve.cameraEvents.length > 0) return s` prevented rebuilding when emphasis words changed after first enable. Fixed: removed the guard, always rebuild on enable.
3. **Two incompatible intensity scales** — Choreography/Camera Punch used 0-1 fractional; Presets slider used 1-5 integer → `maxScale`. Masked by bug #1. Fixed by #5: per-event intensity (0-1) multiplies global `maxScale`; two fields compose correctly.
4. **No hold phase** — Zoom peaked 60ms into the word then immediately decayed. For a 300ms word, zoom was releasing while still spoken. Fixed: envelope now has anticipate → zoom-in → hold (through word duration) → release.
5. **Global slider stomped per-word tuning** — `setCameraIntensity` overwrote every event's `intensity` uniformly. Fixed: only sets `maxScale`, preserves per-event `intensity`.
6. **Stale events on transcript edits** — Covered by fix #2 (always rebuild on enable).

### Verified
- Lint clean, build clean (TypeScript compiles, all routes generate).
- Browser verification pending (demo mode doesn't have video, so camera zoom only visible with real uploaded video).

### Decisions register updates

| # | Decision | Rationale | Status |
|---|----------|-----------|--------|
| 13 | Camera effects on separate `videoEffects` layer, not `Word.transform` | Video zoom ≠ caption transform; architecture must support future pan/shake/rotate | Done |
| 14 | RAF-driven zoom, no CSS transitions on `<video>` wrapper | CSS transitions fight the playback loop, cause lag/rubber-band | Done |
| 15 | Event-based zoom (emphasis words only), not per-word micro-zoom | Most words should produce zero zoom; zoom should feel like intentional camera reaction | Done |
| 16 | Per-event `intensity` as multiplier on global `maxScale` | Per-word Camera Punch and global slider are on separate fields, compose correctly | Done |
| 17 | Three-phase zoom envelope (anticipate → zoom-in → hold → release) | Hold phase keeps zoom at peak while word is spoken; feels like actual editing effect | Done |

---

## 2026-09-04 — Phase 2: Auto-SFX (Sound Design Layer)

### Session goal
Add a fourth reaction to the emphasis moment — **sound**. Speech → typography → camera → SFX all fire together, backed by a deterministic, seeded generator and a Web Audio engine, with per-word manual override and a burned-in export mix.

### Architecture (Preferences vs Composition split, per reviewer)
- `GlobalStyle.sfx` holds only **SfxSettings preferences** (`enabled, density, volume, offsetMs, pack, sfxSeed`) — no generated events.
- New `Project.composition.sfxEvents` holds generated **SfxEvent[]** (`source: auto | manual | choreography`) so events can be regenerated while preserving manual edits.
- New `Project.composition.sfxOverrides: Record<wordId, "none" | SfxName>` — per-word manual decisions; any word present here is excluded from auto generation.

### What was built
- **`src/core/sfx.ts`**: 4 packs (`creator | cinematic | clean | meme`) map semantic `role` (`punchline | cameraPunch | emphasis | transition`) → sound. **role ≠ sound** — packs never expose raw filenames. Deterministic `mulberry32`-seeded `buildSfxTimeline(words, settings, cameraEvents, overrides)`: scores emphasis words (`emphasisStrength*0.5 + punchline*0.3 + cameraEvent*0.2`), culls by density (`top 0/10/25/40/50%`), clusters nearby hits (`<400ms` → ONE reaction). Resolves each candidate's own role through the pack.
- **`src/core/audio.ts`**: `SfxEngine` singleton — one AudioContext (created + resumed in the Play gesture), video routed via `MediaElementSource → voiceGain → master` so ducking never touches `<video>.volume`. Windowed look-ahead scheduler (`LOOK_AHEAD_S = 1.2s`) driven by video time (source of truth) → AudioContext clock. Lazy per-sound `decodeAudioData`, preload, duck envelope anchored at the SFX start time.
- **12 self-owned SFX** in `/public/sfx/` (ffmpeg-synthesized, deterministic, clean licensing — **no** Freesound dependency).
- **Store** (`src/store/editor-store.ts`): `setSfxEnabled/Density/Volume/OffsetMs/Pack`, `regenerateSfx` (replaces only auto), `setSfxOverride` (per-word none/named/inherit), `addManualSfxEvent`. Choreography wires pack+density per bundle (MrBeast=creator/energetic, Cinematic=cinematic/subtle, etc.) and rebuilds auto SFX. Composition persisted.
- **UI**: Presets `SfxControl` (toggle + density + volume + pack + Regenerate); Inspector per-word "Sound FX" dropdown (Inherit / None / specific sound).
- **Export mix** (`ExportPanel.tsx`): when SFX is on, MP4 export consumes the same `sfxEvents` and mixes each sound into its video-time slot via ffmpeg `-filter_complex` → one input + `volume/asetrate/aresample/adelay/aformat` chain per event → `amix` over the video's stereo audio, `-map 0:v -map [aout]`. Validated against real ffmpeg (incl. multi-event + two inputs from the same sample). No Web Audio capture — export derives from event data.

### CodeRabbit review — 11 findings, all addressed
1. **Role preservation**: auto generator always resolved the `emphasis` sound despite scoring punchline/camera signals → `scoreCandidates` now tags each candidate with its dominant role and `buildSfxTimeline` resolves that role through the pack (matches PRD `role ≠ sound`).
2. **SourceWordIds matching**: manual events were matched by ±0.2s timestamp proximity → now matched by `sourceWordIds.includes(word.id)` in both Inspector lookup paths.
3. **Override/silence semantics**: "None" left the auto event audible and a named sound duplicated it → `sfxOverrides` + `setSfxOverride` now suppress (None), replace (named), or restore (Inherit) the event for a word.
4. **Presets a11y**: SFX toggle got `aria-label` + `aria-pressed`.
5. **Autoplay resume**: AudioContext resumed synchronously inside the Play gesture (was mount-effect only).
6. **Elapsed-event replay**: `scheduleAhead` rebases the frontier to `currentVideoTime` after a `clearScheduled`, so resume/seek can't re-fire past events.
7. **Stale retry**: `eventsGeneration` counter — a completed `loadBuffer` only retries if running AND the generation (event list) is unchanged.
8. **Duck timing**: `dimVoice` anchored at the scheduled `when`, not `ctx.currentTime` (look-ahead was returning voice to full volume before the SFX).
9. **Stale sources**: `clearScheduled` now `stop()`s every queued `AudioBufferSourceNode` (records carry the node).
10. **Deterministic IDs**: auto event id = `auto:${seed}:${wordId}:${role}:${sound}` (no persisted churn on identical regeneration).
11. **Volume immediately honored**: `setSfxVolume` remaps gain on every existing event, not just rebuilt ones.

### Conflict resolution (PR #1 was CONFLICTING)
- Root cause: `main` held the feature as one commit (`90320f5`) while `feat/auto-sfx` re-applied content-identical commits (`077b15d` = `90320f5`) plus 2 more → both sides changed the same files.
- **Fix**: `git reset --hard 3b47e40` (pre-feature) on `main`, `git merge --ff-only feat/auto-sfx`, then forced-push `main`. `main` and `feat/auto-sfx` now point to the identical commit `cc243e7`; PR #1 is a clean fast-forward (no diff). Rewrote published `main` history (removed `90320f5`, content preserved).

### Verified
- Lint clean, production build clean.
- Browser: SFX control renders, MrBeast choreography generates 2 events, 12 SFX files served, app loads with no runtime errors.
- Export filtergraph validated against a real ffmpeg binary.

### Decisions register updates

| # | Decision | Rationale | Status |
|---|----------|-----------|--------|
| 18 | SFX preferences live in `GlobalStyle.sfx`; generated events live in `Composition.sfxEvents` | Style = preferences only; events = generated data; regenerate without mutating the style object | Done |
| 19 | Semantic `role ≠ sound`; packs resolve `role → file` | Event carries meaning, not a raw filename; swap packs without touching the timeline | Done |
| 20 | Seeded PRNG (mulberry32) + deterministic auto event IDs | Same seed + inputs = same timeline + same IDs, no persisted churn | Done |
| 21 | Web Audio engine, ducking via `voiceGain` (not `<video>.volume`) | Precise scheduled playback + sidechain-style ducking of the media element | Done |
| 22 | Windowed look-ahead scheduler; export consumes event data, no audio capture | Deterministic preview AND export from the same event list | Done |
| 23 | Per-word `sfxOverrides` (none/named/inherit) persisted in Composition | Manual decisions survive regeneration and suppress/replace auto events | Done |

---

## 2026-09-07 — Video persistence + review hardening

### Session goal
Make the editor's video survive page reloads (IndexedDB), and close four review findings (three real bugs + one silent-failure violation).

### What was built
- **Video persistence (IndexedDB)** — `src/core/persistence.ts` gained `saveVideoToStorage` / `loadVideoFromStorage` / `clearVideoFromStorage` (DB `captionlab-video`, store `files`, key `current`) storing the raw blob + name + type. `setVideoFile` now persists the upload; `Editor` restores it on mount (reconstructs `File` + object URL via new `setRestoredVideo`); `newProject` clears the stored video too. Previously the video was `URL.createObjectURL`-only and died on refresh (captions on black). **Verified end-to-end:** upload 5.7MB `.mov` → IDB hit; reload → video element back (121.9s, plays 0→1.49s); New Project → IDB cleared.
- **Review finding #1 — server ffmpeg fallback (KEEP, made prod-aware).** `transcribe/route.ts`'s `tryWithFfmpeg` shells out to a system binary; on a host without ffmpeg it silently swallowed the `execFile` error and returned Groq's raw rejection. Added a cached `isFfmpegAvailable()` probe; the route now only runs the ffmpeg path when the binary is present, and otherwise returns a **clean, actionable error** (name supported formats; say the server lacks ffmpeg) instead of a raw API string. **Verified locally:** `.mov` → ffmpeg normalize → Groq → 200 / 479 words in 1.27s (Homebrew ffmpeg present).
- **Review finding #2 — position slider dead zone.** `Inspector`'s vertical slider ran 5–90% while `CaptionOverlay` clamped rendering at 82%. Extracted `MIN_CAPTION_Y`/`MAX_CAPTION_Y` to `src/core/styles.ts`; both the slider and the render clamp read the same bounds — no more 82–90 dead zone.
- **Review finding #3 — blob URL leaks.** `setVideoFile` / `setRestoredVideo` now `revokeObjectURL` the previous blob URL before creating a new one (repeated clip swaps no longer leak memory for the tab's lifetime).
- **Review finding #4 — silent persistence failure.** `saveVideoToStorage` returns a boolean (no longer swallows every error); on failure `setVideoFile` surfaces a visible warning via the store's error banner (already rendered by `Editor` at `project.error`), so an un-persisted video is never a silent surprise.

### CodeRabbit follow-up (PR #2) — all findings verified, real issues fixed
CodeRabbit posted 10 comments (7 fixes + 3 nitpicks). All were verified against the code; 9 real issues fixed, 1 perf nitpick deliberately skipped (streaming temp-file write — marginal, fallback-only path).
1. **Groq fetch timeout** — both `fetch` calls now use `AbortSignal.timeout(120_000)`; a `TimeoutError` returns a clear 504 message instead of a generic 500.
2. **ffmpeg child-process timeout** — `execFile` now gets `{ timeout: 5min, killSignal: "SIGKILL" }` so a pathological upload can't hang the route forever.
3. **Temp-file leak + path traversal** — extension is attacker-controlled; now validated (`/^[a-z0-9]{1,6}$/`, fallback `bin`) and the exact written path is tracked and unlinked (was: fixed 12-extension list that missed `flac`/`mpeg`/`mpga`/`opus` and could write an arbitrary path via `../`).
4. **`scaleTo: 0` honored** — Inspector's Scale sliders allow 0; `CaptionOverlay` used `||` (0→140). Switched to `??` so explicit zero scales actually shrink.
5. **Non-finite duration** — `getVideoDuration` can return `Infinity` (MediaRecorder WebM); now only accepted when `Number.isFinite(real) && real > 0`.
6. **Filmstrip canvas distortion** — sizing ran off `!canvas.width`, but a fresh canvas is 300×150 so it never ran; now sizes on first frame capture, so vertical videos render at correct aspect ratio.
7. **Drag-drop audio reject** — picker accepts `audio/*` but drop guard only took `video/`; drop now accepts both.
8. **Video op serialization** — `setVideoFile`/`newProject` writes to `current` are queued (`enqueueVideoOp`) so a slow save can't commit after a New Project clear and resurrect a stale blob on reload.
9. **New Project cleanup** — now revokes the blob URL and surfaces a warning if IndexedDB clear fails (`clearVideoFromStorage` returns a boolean).

**Also from nitpicks:** transcription overlay gets `role="status"`+`aria-live`/speaker `aria-hidden`; async IndexedDB video restore is guarded so a pending read can't clobber a video the user selected meanwhile.
**Skipped:** streaming the upload straight to disk (perf-only nitpick on an already-fallback path).
**Verified:** build + lint clean; `.mov` → ffmpeg fallback → Groq → 200 / 479 words still works.

### Known issue / in progress
- **Server-side ffmpeg is not yet deployed** — the normalization fallback requires a system ffmpeg on the host. It degrades cleanly today (clear error message), but Vercel serverless (or any host) must have ffmpeg installed for unsupported formats to actually transcribe. See PRD Phase 3 / deployment note below.

### Remaining (next sessions)
- Install/verify ffmpeg on the production host when it exists (see PRD note), and re-run the `.mov` fallback check there.
- Finish/verify remaining pre-existing items (camera zoom with real video, demo playback timing post-guard, mobile layout audit).

---

## 2026-09-07 — Undo/redo

### Session goal
Add document-history undo/redo (view state excluded, coalesced gestures) wired to UI buttons and keyboard shortcuts.

### What was built
- **History model** — a store-level undo/redo pair that tracks only the *document subset*: `transcription`, `globalStyle`, `composition`, `speakerStyles`, `speakerMotions`, `groupLayouts`. **Excluded by design** (reference-identity check): playhead, play state, selection, video file/URL, transcription-in-progress, error banner. So scrubbing, playing, marquee-selecting, or the "transcribing…" status never create history entries.
- **Capture-before-change via subscribe** — a `subscribe` listener snapshots the pre-change doc (`cloneDoc`) whenever any tracked field's reference changes. Because actions already create fresh objects only when they mutate, the listener needs zero per-action tracking calls.
- **Gesture coalescing** — a 500ms window merges one gesture (slider drag, marquee bulk edit, rapid burst) into a single undo step: keep the *earliest* pre-gesture snapshot, discard later micro-changes.
- **Undo/redo actions** — `undo()`/`redo()` flush any in-flight gesture, swap snapshots between `undoStack`/`redoStack` (cap 50 each), restore the doc subset while **preserving** `videoUrl`/`isTranscribing`/`error`, and clear the selection (word ids may be stale after undo). The apply is wrapped with `suppressHistory` so restoring a snapshot can't re-capture itself.
- **Boundaries** — `newProject`/`restorePersisted` suppress capture and reset both stacks (project swap is not undoable).
- **UI** — ↺ Undo / ↻ Redo buttons in the header next to New Project, disabled via reactive `canUndo`/`canRedo` store fields; keyboard: `⌘/Ctrl+Z` undo, `⌘⇧/Ctrl+Shift+Z` and `Ctrl+Y` redo, guarded by the existing `isTyping` check so text fields keep native now-edit undo.
- **Verified in browser:** change → canUndo on; Undo reverts + canRedo on; Redo reapplies; two rapid color changes coalesce into ONE undo step; two gestures >500ms apart undo as two steps; New Project resets history; `⌘Z`/`⌘⇧Z` trigger undo/redo; Cmd+Z while an INPUT is focused skips app undo; selection clicks create no history.

### Decisions
- **Capture via subscribe, not per-action calls** — zero risk of forgetting to mark a future mutation, and the reference check is free.
- **Coalesce by earliest baseline** — the whole gesture collapses to one step even if it writes a dozen intermediate states.

---

## 2026-09-07 — Hormozi default style, real timeline bugs, marquee select

### Session goal
Fix the default caption look (user-reported as "pathetic"), match it against real Alex Hormozi reference screenshots, and fix a string of real interaction bugs found by hands-on testing of the timeline and Inspector.

### Default style: Hormozi, not generic bold-white
- **Font: Montserrat → Anton.** Montserrat Black has a documented rendering bug with `-webkit-text-stroke` (`google/fonts#4212`) — thick strokes choke small letter counters (P/O/G/S) into solid black blobs. Confirmed against a user screenshot showing exactly this artifact. Anton (self-hosted via `next/font/google`) is bold/condensed by design for this exact caption use case and doesn't hit the bug.
- **Emphasis is color-only, not size-pop.** Reference screenshots show every word in a Hormozi caption at the *same* size — only the spoken word's color shifts to yellow. The previous 125% (then 108%, then 105%) active-word scale was research-then-eyeball-guessed; real behavior is `scaleTo: 100` (no size change at all). The old size-pop was also the direct cause of a second reported bug: an inflated line height on the active word created a large, ugly gap between wrapped caption lines — fixed as a side effect of going to uniform size.
- **Entrance animation had the same stroke-distortion bug as the (already-fixed) active-word pop** — it was still using `transform: scale()`, which distorts `-webkit-text-stroke` on scaled glyphs. Switched to animating `font-size` directly, matching the fix already applied to the active/emphasis path.
- **Tightened letter-spacing to 0** (was 2, then 0.5) — sourced: "tight letter spacing is a key characteristic of the style," confirmed visually against the reference.
- Final defaults: Anton, 52px, 1px stroke, 0 letter-spacing, no background box, lower-third position — synced across `defaultWordStyle`, the "Hormozi" Presets card, and the `hormozi` choreography bundle (also added as a 7th named vibe with aliases `hormozi`/`alex hormozi`/`gymshark`).

### Real bugs found and fixed (all verified live, not just eyeballed)
- **Inspector's per-word Style/Motion Override panel showed fake values.** It fed sliders `selectedWord.style || {}` — the word's own override only, not its resolved/inherited appearance. A word with no override showed "Stroke Width: 0" even while genuinely rendering at the inherited value, making every slider look disconnected from what was on screen. Fixed by feeding `resolveWordStyle`/`resolveWordMotion` instead.
- **Timeline word-block clicks never moved the playhead.** Selecting a word far from `currentTime` edited a word that literally wasn't rendered (not part of the active caption group), so every style change looked like it did nothing. Fixed by seeking on selection — then found and fixed a regression in that same fix (seeking to `word.start` instead of the actual click position, which snapped the playhead away from wherever the user clicked since word blocks cover almost the entire timeline width). Final version seeks to the exact click position, which is always within the clicked word's own span.
- **Video filmstrip thumbnails** — added real per-frame JPEG captures (14 frames) to the timeline background so it shows the actual video instead of a blank bar; fixed a `react-hooks/set-state-in-effect` violation and a ref-read-during-render violation along the way by keying thumbnails to `{url, frames}` state instead of a ref.
- **Groq key no longer required from end users.** Server route now falls back to `process.env.GROQ_API_KEY`; client no longer blocks upload on a missing key. Key set in `.env.local` (gitignored) and on Vercel (production/preview/development) via `vercel env add` — no deploy triggered. Header API-key input commented out (not deleted).
- **Removed "159 groups" from the header** — internal caption-grouping jargon with no user-actionable meaning; word count kept.

### Marquee / rubber-band multi-select (Figma/Excalidraw parity)
- Drag over empty canvas draws a selection box; every word whose on-screen box intersects it gets selected (`data-word-id` added to `EditableWord` for hit-testing, new `setSelectedWords` store action).
- **Found and fixed a landmine before shipping it**: multi-selecting words and touching any Inspector slider used to silently edit **Global Style** (the whole video's default) instead of the selection, because Inspector only had a single-word branch and fell back to Global for 0 *or 2+* selected words. Added a dedicated bulk-edit branch (`selectedWords.length > 1`) with its own "N words selected" panel.
- Marquee capture required the overlay to go from `pointer-events-none` to capturing all pointer events, which would have silently broken click-to-play/pause on the video (the overlay sits on top of it). Preserved via a new `onBackgroundClick` prop plumbed from `VideoPreview`'s existing `handlePlayPause`.

### Still open
- **Floating contextual toolbar** (font/color/stroke/background attached to the selected caption on canvas, Figma-style) — scoped, not built.
- Timeline zoom and a word search/filter were flagged as real gaps for longer videos (318 words in one test project already made timeline blocks razor-thin) — not started.

---

## 2026-09-07 — CodeRabbit round 2 (PR #2) + hero placeholder

### Session goal
Read the *new* CodeRabbit review on PR #2 (run `3a99b886` — 6 inline comments against post-fix code), verify each is a real issue, fix, and push. Then clear the hero feature-card grid so something important can go there later.

### Review triage — 6/6 were real, all fixed
The first PR review's 10 comments were already fixed in the prior session; this run (on commits `e445d1e`→`f60b081`) added 6 more on the already-hardened code. Each was verified against the live source before changing anything:

1. **Normalized-upload failures were lost.** `tryWithFfmpeg` ran the Groq `fetch` *inside* the ffmpeg try block, so a network failure or timeout became `null` and POST fell back to the direct-upload rejection instead of its 504. And a non-OK *normalized* response was discarded (only `normalized.ok` was checked). Fix: conversion failures still return `null`, but a `TimeoutError` now rethrows out to POST's 504 handler, and a non-OK fallback response is surfaced with its own status + body snippet.
2. **Pending video restore wasn't invalidated by New Project.** The guard only checked `videoFile`, which `newProject` sets to `null` — so a New Project clicked while the IndexedDB read was pending would still restore the stale blob. Fix: capture `project.id` when the read starts; skip restore if the project has since changed.
3. **A storage warning could be wiped by the transcription result.** `setVideoFile` reports IndexedDB save failure asynchronously through `project.error`, but `setTranscription` cleared `error: null` — a failing save followed by a later transcription made the only warning disappear. Fix: `setTranscription` now preserves the existing error instead of nulling it.
4. **Replacement file input advertised less than UploadZone.** The in-editor "Drop a video" picker kept `accept="video/*"`, so an audio upload couldn't be replaced with another audio file from that path. Now matches UploadZone's `audio/*,video/*` filter.
5. **Stale save failure could fire on newer state.** If a file replacement or New Project happened before `saveVideoToStorage` resolved, the old blob's `persisted === false` called `setError` on the new state. Fix: a `videoSaveGeneration` counter — captured before enqueue, incremented on replacement and New Project — gates whether the failure report applies.
6. **Undo coalescing window didn't slide.** `pendingSince` stayed at the first change, so a slider drag longer than 500ms committed an intermediate baseline and split one gesture into multiple undo steps. Fix: each adjacent document change refreshes `pendingSince`, keeping one uninterrupted gesture as one undo step.

**Verified:** `tsc --noEmit` and lint clean (only pre-existing `ApiKeyInput`/`setApiKey` unused warnings). Committed as `56f67d5` and pushed to `upstream/improvements`; PR head confirmed at `56f67d5`.

### Hero placeholder (feature-card grid removed)
- The landing hero's four-card grid (incl. "AI choreography in plain English") is replaced with a clearly-marked dashed placeholder — `Reserved for something important` — so the block can be swapped for real content later.
- Removed the now-unused `FeatureCard` component and `FEATURE_ICONS` map (lint-clean).

**Follow-up: feature cards restored.** The hero's four-card grid was later put back (turn: "reserved for something important — we removed the features we had earlier"). The `FeatureCard`/`FEATURE_ICONS` code was re-added and the dashed `Reserved for something important` placeholder removed from the landing hero. This lives in the uncommitted working tree.

### Decisions
- **Distinguish conversion failure from upload failure in the ffmpeg fallback.** A file ffmpeg can't read should say so; but a Groq timeout/network error on the normalised upload is an *upload* failure and must surface as its own status (504), not be silently misreported as the original rejection. It took an explicit `TimeoutError` rethrow to reconnect the fallback to the route's 504 handler.
- **Every stale async result needs a generation.** The save-failure report and the pending video restore both got bitten by an old operation landing on new state; a monotonic `videoSaveGeneration` (and `project.id` for the restore) scopes async consequences to their origin.

---

## 2026-09-07 — Editor layout refactor: collapsible sidebars, floating toolbar, timeline zoom

### Session goal
Restructure the bottom tab bar into two collapsible side panels (Transcript + Style), build the previously-scoped floating contextual toolbar and multi-point resize, add timeline zoom, and normalize the app on a layered dark-gray theme with one green accent.

### Layout restructure
- **Transcript panel (new `TranscriptPanel.tsx`)** — its own collapsible left panel; **Style panel** (Inspector/Presets) is a second collapsible right panel (✕ to collapse). Collapsed panels drop to a vertical `CollapsedSidebarTab` (◀ + rotated label) that re-opens them. The old bottom Inspector/Presets tab bar is removed.
- Accent normalized to the existing green `#00FF66` (active tab underline, sliders, counts) — the mix of blue/green highlighted states is gone.

### Transcript panel behavior
- Per-sentence paragraphs; a **plain click** jumps to the *exact* word clicked (not the sentence start — clicking the 4th word of a long sentence lands on the 4th word) while selecting the whole sentence so the matching range also lights up in the Timeline; **⌘/Ctrl+click** keeps the fine-grained per-word multi-select.
- **Notable-word highlighting** — tokens containing digits render green (`NOTABLE_WORD`), on the grounds that numbers are what speech-to-text gets wrong most often; the highlight draws the eye to what's worth double-checking.
- **Edit mode toggle (pencil)** — a per-sentence `contentEditable` surface (`EditableSentence`): click anywhere places a real native caret and free text editing works like a normal field. On blur the text splits back by whitespace and maps positionally onto word ids — **but only if the word count is unchanged**; an edit that splits/merges words reverts rather than leaving a timestamp-less word, which the data model can't represent.

### EditableWord upgrades
- New `editable` (gate editing entirely) and `editOnSingleClick` (click-to-edit for an explicit edit-mode context) props.
- Caret is placed near where the user clicked (character-offset approximation) on open, instead of select-all-ing the word — which read as "did my click even land?".

### Floating contextual toolbar (scoped in the Hormozi session → built now)
- **Font family select, font-size −/+, text color, stroke color, stroke-width −/+** — attached under the selected caption directly on canvas (VEED/Figma-parity item from the earlier audit; was listed as "still open").

### Multi-point resize (Figma-style)
- **All 4 corners + 4 edge midpoints**, each with an outward unit direction vector; drag is projected onto that direction so dragging away always grows and toward always shrinks. Uniform `scale` (the data model has no separate width/height — a caption is text, not a box).
- **Measured-frame positioning:** the row is visually scaled via `transform: scale()` (paint-only — the layout box stays at the unscaled size), so CSS-class-anchored handles would drift from the rendered text. Handles/toolbar instead sit on a frame measured from `getBoundingClientRect` each render — and re-measured on every `currentTime` tick, since active/emphasis word pops change the row's size during playback.
- A **single selected word** gets the same dashed frame via measurement — not a CSS `outline`, which renders dashes with different spacing and reads as "why is this one thicker."

### Timeline zoom
- Magnifying-glass − / + buttons, a 1–4× slider, and a **Fit** button; the timeline body width scales with the zoom level inside `overflow-x-auto`. (Zoom and word-search were flagged as long-video gaps in the Hormozi session — zoom is done, search remains.)

### Presets simplified
- The AI-choreography prompt box and suggestion chips are gone. The single presets list now applies the **full choreography bundle** for names that share one (`CHOREOGRAPHED_PRESETS`: Hormozi, MrBeast, Clean, Neon) and plain style+motion for the rest — one list, not two.

### Theme: layered dark-gray system
- Base `zinc-950 → zinc-900`, panels `zinc-900 → zinc-800`, controls one step lighter; hero headline switched from the animated `hero-word-pop` to a gradient-clipped "speech"/"animated typography" treatment; transcribing spinner and highlight states use the `#00FF66` accent.

### PRD
- Added a Phase 3 candidate: **Player transport controls** — replace the plain-text "Play" with an icon-only `▶`/`⏸` and optional `▶ 00:12 / 02:01` time readout, a compact toolbar (`↶ ▶ ↷  time  🔊,`), and a playback-speed menu (`0.5×/1×/1.5×/2×`). Not built.
- Added a Phase 3 candidate: **Export dropdown** — consolidate the header's three separate `SRT / VTT / Export MP4` buttons into a single `Export ▾` (main button exports MP4; the item list exposes Export MP4 / Export SRT / Export VTT), so the header stops advertising three export buttons at once. Not built.

### Verified
- `tsc --noEmit` clean; lint clean (only the pre-existing `ApiKeyInput`/`setApiKey` unused warnings).

### CodeRabbit round 3 (PR #3) — review fixes applied in the working tree
- **Remeasure selection frames after style/text edits (Major).** The `frame`/`wordFrame` effects only depended on `isSelected`, `layout.scale`, `currentTime`, `activeGroup?.id` — a floating-toolbar font change or a committed word-text edit reflows the row without touching those deps, so the handles/outline drifted. Both effects now attach a `ResizeObserver` to the row (and the single word element) and remeasure on any real geometry change; also added the missing `layout.scale` to the word-frame deps (dragging a resize handle while a single word was selected left it stale).
- **Explicit `fontFamily` option for unknown/missing values (Minor).** `WordStyle.fontFamily` is optional and pre-Presets use values (`Arial Black`, `system-ui`) not in `TOOLBAR_FONTS`, so the select showed "Anton" while the caption used another family (or the first option for `undefined`). The select now renders a fallback `<option>` titled from the family's first token (or "Custom") when the current value isn't a listed font.
- **Secondary text contrast (Minor).** `text-zinc-500`/`zinc-600` on the `bg-zinc-800` Timeline ran 1.93–3.08:1; the `or` chip `zinc-500` on `zinc-700` was 2.16:1. Bumped those to `text-zinc-400`. The `zinc-400` UploadZone helper text was already above 4.5:1 — left alone.
- **Caret lookup on older Firefox (Minor).** `caretRangeFromPoint` is Firefox 150+; older versions only have `caretPositionFromPoint` (and the optional call returned `undefined`, exiting before seeking). The handler now tries `caretPositionFromPoint` first and falls back to `caretRangeFromPoint`, normalizing both shapes (`offsetNode`/`offset` vs `startContainer`/`startOffset`) into `{container, offset}` for the shared tree-walker.

### Still open
- Timeline word search/filter (long-video gap from the Hormozi session).
- This refactor is implemented in the working tree but **not yet committed** or browser-verified end-to-end.

---

## 2026-09-08 — Four Phase 3 items shipped (transport, range-select, presets, export) + PRD §2.5

### Session goal
Implement the four previously-"not committed" Phase 3 candidates in one pass (player transport controls, timeline range-select, savable custom presets, export dropdown), all browser-verified — and spec the caption-animation-controls differentiator in the PRD.

### PRD
- Added **§2.5 Caption Animation Controls ✅ Major Differentiator** — a 7-type animation picker (None / Fade / Pop / Bounce / Typewriter / Word-by-word / Slide) with tiny live previews on hover, per-word override, timing controls (duration / stagger / easing), and AI choreography auto-selection (punchline→Pop, question→Slide, emphasis→Bounce, default→Fade). Spec sits in Phase 2 alongside camera + SFX.

### Player transport controls (was: Phase 3 "not committed") — implemented
- New `src/components/TransportControls.tsx`: `↶  ▶/⏸  ↷  00:12 / 02:01  speed`. Replaces the plain-text `Play`/`Pause` buttons in **both** the demo overlay (`Editor`) and the real video (`VideoPreview`).
- **Speed menu** (`0.5× / 1× / 1.5× / 2×`): demo RAF loop advances `dt × playbackRate`; the `<video>` element gets `video.playbackRate` on play *and* reactively via an effect so a mid-play speed change applies live. `playbackRate` lives in the store (view state — intentionally **not** undo-tracked).
- **Skip ±5s** reads `useEditorStore.getState().currentTime` instead of the render closure — fixed a real stale-closure bug where two rapid skips both computed from the same old time.
- Verified live in the browser: title flips Play↔Pause (Space semantics preserved), time advances 2.92→3.62s on play, 2× speed measured ≈ 1.98s video per 1s wall, +5s/−5s and the speed menu all land correctly.

### Timeline range-select (VEED's #1 unaddressed request) — implemented
- **Drag on empty track background** selects every word whose `[start, end]` intersects the drag range; the range renders as a translucent blue band; the selection feeds the existing bulk-edit Inspector ("N words selected", Style + Motion override for all).
- **Drag-start disambiguation** (per PRD design): word-block clicks keep select-and-seek, edge-drag handles keep retiming, and the playhead handle — previously inert — is now **draggable to scrub** (`data-playhead`). A drag-only selection never seeks the playhead; a plain click still seeks.
- First implementation called `setSelectedWords` inside a `setRangeSel` updater → React `set-state-in-render` warning. Refactored to a `rangeRef` read in the `mouseup` handler; warning confirmed gone (0 occurrences in a cleared dev log).
- Verified live: 8%→55% drag selects 20 words (bulk panel "20 words selected"), 16–17-word drags, single word-block click selects 1 word + seeks to the click position, playhead drag scrubs 0→7.83s. **Bulk-reposition deliberately scoped out** (position is per-group, not per-word) — same first-pass cut as the PRD's.

### Savable custom presets (VEED's most-praised capability) — implemented
- "Save current style as preset" card at the top of the Presets panel: name input + Save → a `Partial<GlobalStyle>` snapshot (`style` + `motion` + `transform`) stored **globally** in `localStorage` under `captionlab_custom_presets`, rendered under a green "Your Presets" divider with a per-card delete (✕).
- Applied with the same `applyPreset` path as built-ins; snapshots carry across videos (global, not per-project).
- Verified live: save → "Your Presets"/"Saved…" → full snapshot written to localStorage → survives a page reload → delete removes it (`[]`).

### Export dropdown (was: Phase 3 "not committed") — implemented
- `ExportPanel` is now one split control: the main **Export** button burns MP4 directly; the chevron ▾ opens `Export MP4 / Export SRT / Export VTT`. The header no longer advertises three separate export buttons. Out-of-element click closes the menu.
- Verified live: chevron opens all three items; main button label still carries the in-progress export status.

### Transcript panel polish (user tweak)
- Inactive sentence rows in `TranscriptPanel` switched from a visible `border-zinc-700` left rail to `border-transparent`, so only the active (playing) sentence shows the green rail — the transcript reads as calm focus instead of a row of gray borders. One-line class change; active/selected states untouched.

### Resizable sidebars (react-resizable-panels v4)
- **Library**: `react-resizable-panels` **v4** (`Group`/`Panel`/`Separator`, the rewritten API — exports `Group` not `PanelGroup`, `Separator` not `PanelResizeHandle`, imperative collapse via `panelRef`). Stable, React-19-peer-supported, the panel library behind Vercel-style editors. Alias-imported `Panel as ResizablePanel` to dodge Editor's existing `type Panel`.
- **Layout**: one `Group direction="horizontal"` wraps the whole canvas row with ids `editor-main` (default 58%, min 30%), `editor-transcript` (default 22%, min 14%, max 40%), `editor-style` (same as transcript). When there is no transcription the group renders only the main panel — the conditional `ResizableSidebar`s simply aren't mounted.
- **Drag strip**: each sidebar renders its own `<Separator>`; *open* → a 6px drag pill (hover → green glow) you drag to resize; *collapsed* → the existing vertical `CollapsedSidebarTab` (w-7, ◀ + vertical label) rendered **inside** the separator, so the strip and the reopen affordance are the same element. Double-click on a separator resets that panel to its default size (library built-in). After a follow-up pass the open strip now shows the classic **grip-vertical drag handle** (2×3 dot pattern, inline SVG, zinc → green glow on hover) instead of the plain pill — reads unmistakably as "draggable" without adding an icon dependency.
- **Collapse sync**: v4 has no controlled `collapsed` prop, so `open` (the editor's `showTranscript`/`showStylePanel`) is mirrored to the panel imperatively — an effect calls `panelRef.collapse()/expand()`, and a `ResizableSidebar` `onResize` handler polls `panelRef.isCollapsed()` to fold drag-originated collapses back into React state (guarded by an `openRef` so it never loops). ✕ still collapses; clicking the tab expands to the panel's most-recent size.
- **Content**: `TranscriptPanel` and the Style wrapper moved off fixed `w-72` to `w-full min-w-0 h-full` so they fill whatever width the user drags to.
- Verified live in the browser at 1280×800: pointer-drag on the transcript separator collapsed the panel and popped the tab in (0 errors, tab at x≈977), tab click re-expanded, ✕ collapsed back to 0, a normal style-panel drag widened 273→349px without collapsing, and a fresh reload landed on the defaults (721/273/273). `tsc --noEmit` clean; eslint shows only the two pre-existing warnings. Layout widths are deliberately **not** persisted across reloads (no `useDefaultLayout`) — predictable defaults each load.

### Open
- **"Fit the seek bar of volume"** — a user request in this session refers to an attached screenshot this model could not read; no volume/seek-bar element exists in the app today. Awaiting clarification before acting (candidate readings: a video volume slider on the transport, or the timeline seek bar's layout).
- Timeline word search/filter (long-video gap from the Hormozi session) remains.
- The 2026-09-07 layout refactor (collapsible panels, floating toolbar, multi-point resize, timeline zoom) is committed to the working tree but still entirely uncommitted to git alongside this session's four features.

### Decisions
- **`playbackRate` is store view state** (not part of the undo document subset): speed is a playback preference, not an edit.
- **Range-select by start location, not a mode toggle** — dragging the playhead scrubs, dragging the background selects, word-blocks keep click/edge-drag semantics; no separate "selection tool" state to get stuck in.
- **Custom presets live in a separate localStorage key** (`captionlab_custom_presets`) rather than the existing project autosave key, so a preset is global and survives New Project.
- **Skip buttons read the store directly**, not the render-closure `currentTime`, so repeat taps in the same frame can't double-apply a stale time.

---

## 2026-09-08 — CodeRabbit review triage on PR #4

### Session goal
Review the CodeRabbit comments posted on PR #4, separate real bugs from noise, and fix the genuine ones.

### Verdicts
- **Timeline `didRangeDrag` sticky flag (Major, valid)** — `onMove` set `didRangeDrag.current = true` and only `handleClick` cleared it. If a range-drag ended with the mouse released **outside** the timeline container, no `click` fired on the container so the flag stayed `true` and the user's next plain seek click was silently swallowed. Fixed by resetting `didRangeDrag.current = false` at the start of each background `mousedown` (before `onMove` can set it), while keeping the `handleClick` guard that suppresses seeking after an in-container drag.
- **Timeline search Enter skips the first match (Minor, valid)** — typing a query highlights match index 0 (ring + `1/N`), but the first Enter ran `jumpToMatch(matchIndex + 1)` so it navigated to the *second* match; the highlighted one was unreachable forward (only Shift+Enter → wrap could hit it). Added a `visitedMatchRef` so the first Enter jumps to the currently-displayed match, subsequent Enter/Shift+Enter keep next/prev; the ref resets on query change, Escape, and the ✕ clear button.
- **VideoPreview `duration` can become `Infinity` (Minor, valid)** — `onLoadedMetadata` stored `e.currentTarget.duration` unguarded; MediaRecorder-style WebM reports `Infinity`, which would poison the transport's time readout and skip-clamping. Now accepts the duration only when `Number.isFinite(d) && d > 0`, otherwise `0` — mirroring the existing `getVideoDuration` guard in `Editor.tsx`.
- **PRD §2.5 marked as shipped (Minor, valid)** — the heading carried `✅ Major Differentiator` and "Why this wins" said "We offer 7+ animations", but caption animations are spec-only. Retitled to `(Spec — Planned)` and switched the claim to future tense until the picker/runtime/export paths exist.
- **ExportPanel duplicate concurrent exports (Major, rejected)** — the reviewer's premise ("menu stays open, second click starts a second FFmpeg encoder") doesn't hold in current code: the main Export button *and* the chevron are both `disabled={!transcription || isExporting}` during an export, the dropdown's "Export MP4" item already calls `setMenuOpen(false)` before `exportMP4()`, and React 18 flushes discrete click events synchronously so the disabled state applies before a second click can land. No change made.

### Verified after fixes
- `tsc --noEmit` clean; eslint still only the two pre-existing warnings.

---

## Decisions register

| # | Decision | Rationale | Status |
|---|----------|-----------|--------|
| 1 | Next.js 16 + Turbopack, empty `turbopack: {}` config | Next 16 defaults to Turbopack; webpack config breaks build | Done |
| 2 | Engine in plain TS, framework-agnostic (`src/core/`) | Portability to Tauri; unit-testable | Done |
| 3 | Single zustand store for editor state | Simple, reactive, no Redux ceremony | Done |
| 4 | Add no-key **demo mode** for judges | URL-only demo must work without signing up for Groq | Done |
| 5 | CaptionGroups derived from words, not stored separately | Single source of truth; groups = view | Done |
| 6 | Groq key proxied via server route, held in localStorage | Privacy + not exposing key to third parties | Done |
| 7 | Emphasis/punchline words get an `emphasis` recipe (scale→140, gold, glow) | Punchlines pop without a keyframe editor | Done |
| 8 | Natural-language choreography maps to curated bundles (no LLM call in-loop) | Fast, deterministic, offline-friendly, still feels agentic | Done |
| 9 | Autosave project to localStorage (debounced 300ms), no manual Save button | Simplest + best UX for a judge demo | Done |
| 10 | Don't persist the source video blob/`File`; restore onto black canvas | Blob URLs/File are ephemeral/binary — too large and not meaningful across reloads | Done |
| 11 | Emphasis punchlines render as a single scale(140%) pop (not stacked scales) | A stacked 140%×125% transform looked broken and skipped entrance motion | Done |
| 12 | Words are edited inline via a reusable `EditableWord` (double-click) matched to resolved style | Seamless in-place correction that auto-propagates to export and persists | Done |
| 13 | Camera effects on separate `videoEffects` layer, not `Word.transform` | Video zoom ≠ caption transform; architecture must support future pan/shake/rotate | Done |
| 14 | RAF-driven zoom, no CSS transitions on `<video>` wrapper | CSS transitions fight the playback loop, cause lag/rubber-band | Done |
| 15 | Event-based zoom (emphasis words only), not per-word micro-zoom | Most words should produce zero zoom; zoom should feel like intentional camera reaction | Done |
| 16 | Per-event `intensity` as multiplier on global `maxScale` | Per-word Camera Punch and global slider are on separate fields, compose correctly | Done |
| 17 | Three-phase zoom envelope (anticipate → zoom-in → hold → release) | Hold phase keeps zoom at peak while word is spoken; feels like actual editing effect | Done |
| 18 | Undo/redo tracks only the document subset, captured via store subscribe | Selection/scrub/play/video are view state — undo is for edits only; subscribe + reference-check needs no per-action calls | Done |
| 19 | 500ms gesture coalescing, earliest-baseline kept | A slider drag/marquee is one undo step, not a dozen | Done |
| 20 | `newProject`/`restorePersisted` reset history rather than being undoable | Project swap destroys blobs/storage that can't be restored; an undo back to a dead project is worse than no undo | Done |
| 21 | Default caption font is Anton, not Montserrat | Montserrat has a documented `-webkit-text-stroke` rendering bug (google/fonts#4212) that chokes small letter counters into solid blobs; confirmed against a real screenshot | Done |
| 22 | Hormozi-style emphasis is color-only (no active-word size pop) | Reference screenshots show uniform word size; size-popping is the MrBeast look, and it was also inflating line-height and breaking multi-line caption spacing | Done |
| 23 | Multi-select gets its own Inspector bulk-edit branch, not a Global Style fallback | Silently editing the whole video's default style when 2+ words were selected was a real correctness landmine, made more likely once marquee-select shipped | Done |
| 24 | Normalized-upload failures stay distinct from ffmpeg conversion failures (timeout rethrown → 504; non-OK surfaces its own status) | A Groq timeout is an upload failure the user should see as such; converting it to `null` masked it as the original rejection | Committed `56f67d5` |
| 25 | Async video restore is scoped to `project.id`; a New Project invalidates a pending restore | Otherwise a stale persisted blob reappears over a freshly started project | Committed `56f67d5` |
| 26 | `setTranscription` preserves the existing `project.error` instead of clearing it | A video-persistence failure reported asynchronously must not be wiped by a later successful transcription | Committed `56f67d5` |
| 27 | Video save-failure reports are gated on a `videoSaveGeneration` counter | A stale `persisted === false` from an old blob must not `setError` on newer state | Committed `56f67d5` |
| 28 | Hero feature-card grid was briefly replaced with a placeholder, then restored | The `FeatureCard`/`FEATURE_ICONS` code was re-added after the user asked to keep the earlier features; placeholder removed | Working tree |
| 29 | Transcript and Style live in separate collapsible side panels, not a shared bottom tab bar | Both need to be visible simultaneously; collapsing to a vertical tab keeps room for the canvas/timeline | Working tree |
| 30 | Selected-caption toolbar and resize handles are positioned from measured `getBoundingClientRect` geometry, re-measured per `currentTime` tick | The row scales via paint-only `transform: scale()`, so CSS-anchor-based handles would drift from the rendered text; active-word pops change size continuously during playback | Working tree |
| 31 | Resize is uniform `scale` driven by a direction-projected drag on 8 handles | A caption is text, not a box — no width/height; projecting drag onto each handle's outward vector makes grow/shrink intuitive from any corner or edge | Working tree |
| 32 | Transcript sentence edits commit only when the word count is unchanged | Splitting/merging words would leave a word with no timestamp, which the data model can't represent — revert, don't corrupt timing | Working tree |
| 33 | Preset list applies the full choreography bundle for shared names (Hormozi/MrBeast/Clean/Neon), plain style+motion otherwise | One list, not two; the richer bundle is strictly better for those names | Working tree |
| 34 | Selection frames re-measure via `ResizeObserver` attached to the row/word element, not just dependency-driven effects | Style/text edits reflow geometry without touching the effect deps; observing the element catches every real geometry change (incl. edits), and the word frame now also re-measures on `layout.scale` | Working tree |
| 35 | Caption Animation Controls spec'd as PRD §2.5 (7 types + live previews + per-word override + AI auto-selection) | Positioned as a major differentiator — competitors offer 2–3 generic animations with no preview | Spec |
| 36 | `playbackRate` is store view state, excluded from undo history | Speed is a playback preference, not a document edit; scrubbing/playing already exclude view state | Working tree |
| 37 | Timeline range-select is disambiguated by drag **start location**, not a mode toggle (playhead=scrub, background=range, word-block=click/edge-drag) | No selection-tool state to get stuck in; matches the PRD's resolved-but-unbuilt design; bulk-reposition deliberately scoped out of first pass | Working tree |
| 38 | Custom presets stored globally under a dedicated `captionlab_custom_presets` key, applied via the existing `applyPreset` path | A preset should survive New Project and carry across videos, unlike the per-project autosave blob | Working tree |
| 39 | Export is one split control (main button = MP4, chevron = SRT/VTT/MP4) | The primary action stays the obvious default; the header stops advertising three export "buttons" at once | Working tree |
| 40 | Transport skip buttons re-read the store's `currentTime`, never the render closure | Two rapid skips in one frame otherwise both compute from the same stale time and cancel out | Working tree |
| 41 | `react-resizable-panels` v4 for resizable sidebars (`Group`/`Panel`/`Separator` + `panelRef` imperative API) | Stable, React 19 peer-supported, the de-facto panel library (Vercel-style editors); a hand-rolled drag-width would've been ~150 lines of pointer/uuid math | Working tree |
| 42 | Sidebar width is **not** persisted (no `useDefaultLayout`); open/closed stays editor state, mirrored imperatively (`collapse()`/`expand()` in an effect, drag-collapses folded in via `onResize` + `isCollapsed()`) | v4 has no controlled `collapsed` prop; predictable defaults each load beat remembered-layout edge cases (drag-to-zero restoring "open" on reload) | Working tree |
| 43 | The drag separator doubles as the collapsed reopen tab (thin pill when open → `CollapsedSidebarTab` inside the Separator when closed) | One element serves drag-resize and show/hide; the old `CollapsedSidebarTab` is reused inside the Separator | Working tree |
| 44 | Search navigation is query-scoped: a `visitedMatchRef` makes the first Enter jump to the already-highlighted match, then Enter/Shift+Enter cycle next/prev; reset on query change/Escape/clear | Otherwise the first Enter skips the first match — the ring's `1/N` target is only reachable backwards via wrap | Working tree |
