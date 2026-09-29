"use client";

import { useRef, useCallback, useMemo, useState, useEffect, useLayoutEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import { sliderFillStyle } from "./rangeFill";

// Filmstrip density. The frame count is derived from the video's duration
// rather than fixed, so scene changes are actually sampled: a fixed 14 put
// one thumbnail every ~46s on a 10-minute clip, so no cut ever landed on a
// thumbnail and the strip read as unrelated, smudgy stills.
const FILMSTRIP_TARGET_SEC = 4;
const MIN_FILMSTRIP_FRAMES = 8;
const MAX_FILMSTRIP_FRAMES = 48;
// The lane is 64 CSS px tall; capture at 2x so the strip stays sharp on HiDPI.
const FILMSTRIP_HEIGHT = 64;
const FILMSTRIP_QUALITY = 0.82;
// Below this, a cell can't fit more than a sliver of its capture — bg-cover
// center-crops a 16:9 frame down to a few px wide, and dozens of those
// slivers side by side read as noise/interlacing rather than thumbnails.
// Long clips were hitting MAX_FILMSTRIP_FRAMES while the track itself stayed
// a fixed ~680px, so every clip past ~3.2 minutes got squeezed the same way
// regardless of how much longer it ran. 48px still read as noisy once a real
// (not synthetic) transcript's caption blocks narrowed the usable track —
// went wider so cells are unambiguously a picture, not a sliver.
const MIN_FILMSTRIP_CELL_PX = 96;
// Backstop so a seek can never stall the strip: `awaitFrame` also settles on
// 'seeked', but a browser that delivers neither signal must still produce a
// frame rather than leaving the timeline permanently blank.
const FILMSTRIP_FRAME_WAIT_MS = 1200;
// Throttle for progressive publishing, so a long capture fills the strip in
// without re-rendering the timeline on every single frame.
const FILMSTRIP_PUBLISH_MS = 200;

export default function Timeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sfxTrackRef = useRef<HTMLDivElement>(null);
  const transcription = useEditorStore((s) => s.project.transcription);
  const videoUrl = useEditorStore((s) => s.videoUrl);
  const [filmstrip, setFilmstrip] = useState<{
    url: string;
    frames: string[];
    // Frame count this strip was built for, so cells can be sized to it while
    // the strip is still filling in.
    count: number;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [rangeSel, setRangeSel] = useState<{ a: number; b: number } | null>(null);
  const didRangeDrag = useRef(false);
  // Tracks whether the current search query has been navigated yet, so the
  // first Enter jumps to the match already highlighted (index 0) instead of
  // skipping past it.
  const visitedMatchRef = useRef(false);
  const rangeRef = useRef<{ a: number; b: number } | null>(null);
  const currentTime = useEditorStore((s) => s.currentTime);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const selectWord = useEditorStore((s) => s.selectWord);
  const setSelectedWords = useEditorStore((s) => s.setSelectedWords);
  const retimeWord = useEditorStore((s) => s.retimeWord);
  const sfxEvents = useEditorStore((s) => s.project.composition.sfxEvents);
  const sfxEnabled = useEditorStore((s) => s.project.globalStyle.sfx.enabled);
  const sfxPack = useEditorStore((s) => s.project.globalStyle.sfx.pack);

  const duration = transcription?.duration || 0;

  // Role → lane color for SFX markers.
  const sfxRoleColor: Record<string, string> = {
    emphasis: "bg-blue-400",
    punchline: "bg-amber-400",
    cameraPunch: "bg-violet-400",
    transition: "bg-cyan-400",
  };

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || !duration) return;
      // A range-select drag ends in a click — don't also seek the playhead.
      if (didRangeDrag.current) {
        didRangeDrag.current = false;
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = x / rect.width;
      setCurrentTime(pct * duration);
    },
    [duration, setCurrentTime]
  );

  // Drag on the empty timeline background to range-select all words that
  // intersect the selection (the bulk-edit Inspector panel consumes the multi
  // selection). Word blocks / edge handles / the playhead have their own drag.
  const handleBackgroundMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-word-block]") || t.closest("[data-playhead]")) return;
      if (!containerRef.current || !duration) return;
      e.preventDefault();
      // A new interaction starts clean so a stale drag flag from a mouseup
      // that landed outside this container can't eat the next plain seek click.
      didRangeDrag.current = false;
      const rect = containerRef.current.getBoundingClientRect();
      const toPct = (clientX: number) =>
        Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      const a = toPct(e.clientX);
      const range = { a, b: a };
      rangeRef.current = range;
      setRangeSel(range);

      const onMove = (ev: MouseEvent) => {
        const b = toPct(ev.clientX);
        if (Math.abs(b - a) > 0.002) didRangeDrag.current = true;
        range.b = b;
        rangeRef.current = { a, b };
        setRangeSel({ a, b });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (didRangeDrag.current) {
          const sel = rangeRef.current;
          if (sel && transcription && duration) {
            const t0 = Math.min(sel.a, sel.b) * duration;
            const t1 = Math.max(sel.a, sel.b) * duration;
            const ids = transcription.words
              .filter((w) => w.end >= t0 && w.start <= t1)
              .map((w) => w.id);
            if (ids.length > 0) setSelectedWords(ids);
          }
        }
        rangeRef.current = null;
        setRangeSel(null);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [duration, transcription, setSelectedWords]
  );

  // Drag the playhead handle to scrub (it previously only indicated position).
  const handlePlayheadMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      if (!containerRef.current || !duration) return;
      const rect = containerRef.current.getBoundingClientRect();
      const move = (ev: MouseEvent) => {
        const pct = Math.min(Math.max((ev.clientX - rect.left) / rect.width, 0), 1);
        setCurrentTime(pct * duration);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [duration, setCurrentTime]
  );

  const playheadPct = duration ? (currentTime / duration) * 100 : 0;

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !transcription) return [];
    return transcription.words.filter((w) => w.text.toLowerCase().includes(q));
  }, [searchQuery, transcription]);

  const matchIds = useMemo(() => new Set(searchMatches.map((w) => w.id)), [searchMatches]);

  const jumpToMatch = useCallback(
    (idx: number) => {
      if (searchMatches.length === 0) return;
      const clamped = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
      const word = searchMatches[clamped];
      setMatchIndex(clamped);
      setCurrentTime(word.start);
      selectWord(word.id);
      // Scrolls the nearest scrollable ancestor (the zoomed timeline's
      // overflow-x-auto wrapper) so the match is visible even when it's
      // currently off-screen at higher zoom levels.
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-word-id="${word.id}"]`)
        ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    },
    [searchMatches, setCurrentTime, selectWord]
  );

  const wordPositions = useMemo(() => {
    if (!transcription) return [];
    return transcription.words.map((w) => ({
      ...w,
      startPct: (w.start / duration) * 100,
      widthPct: ((w.end - w.start) / duration) * 100,
    }));
  }, [transcription, duration]);

  const sfxPositions = useMemo(
    () =>
      sfxEvents.map((ev) => ({
        ev,
        startPct: (ev.start / duration) * 100,
        widthPct: Math.max(((ev.duration ?? 0.2) / duration) * 100, 0.4),
      })),
    [sfxEvents, duration]
  );

  const showSfxLane = sfxEnabled && sfxEvents.length > 0;
  const thumbnails = useMemo(
    () => (filmstrip?.url === videoUrl ? filmstrip.frames : []),
    [filmstrip, videoUrl]
  );
  const filmstripCount = filmstrip?.count ?? MIN_FILMSTRIP_FRAMES;

  // Track the strip's actual on-screen width — it changes with `zoom`, since
  // the track lives in a div sized to `${zoom * 100}%` of its scroll parent.
  // Read the width directly on mount rather than waiting on the observer's
  // first callback: ResizeObserver's initial invocation isn't guaranteed to
  // fire promptly (or at all) in a backgrounded/automated tab, and stalling
  // on `trackWidth === 0` is exactly the failure mode this is guarding
  // against — it silently fell back to a forced density and reproduced the
  // narrow-cell smear this whole fix exists to prevent.
  const [trackWidth, setTrackWidth] = useState(0);
  // Re-measure whenever `zoom` changes rather than trusting the observer to
  // catch it: a zoom-driven width change is a style change on an element we
  // already hold a ref to, not an external resize, and RO's first callback —
  // let alone a later one — isn't guaranteed to land promptly in a
  // backgrounded/automated tab. Confirmed by direct testing: the container
  // grew from 521px to 781px on zoom, and RO never reported either width.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) setTrackWidth(el.clientWidth);
  }, [zoom]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setTrackWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // How many of the captured frames actually fit at MIN_FILMSTRIP_CELL_PX
  // given the current width. Capture always targets full duration-based
  // density (see the effect below); this decides how much of that density
  // to show — fewer, wider cells at the default zoom, more as the user
  // zooms in and the track (and thus this width) grows.
  const displayCount = useMemo(() => {
    if (trackWidth <= 0) return Math.min(filmstripCount, MIN_FILMSTRIP_FRAMES);
    // The width is the hard ceiling here — a narrow track must show fewer
    // than MIN_FILMSTRIP_FRAMES cells rather than forcing that many in
    // regardless of space. `Math.max(MIN_FILMSTRIP_FRAMES, ...)` was the bug:
    // it guaranteed at least 8 cells no matter how little room there was,
    // which is exactly what re-crushed the strip on a track narrower than
    // the ~680px this was tuned against.
    const maxByWidth = Math.max(1, Math.floor(trackWidth / MIN_FILMSTRIP_CELL_PX));
    return Math.min(filmstripCount, maxByWidth);
  }, [filmstripCount, trackWidth]);

  // Even sampling rather than a straight slice, so the displayed set always
  // spans the full clip instead of clustering near whatever's captured so far.
  const displayedThumbnails = useMemo(() => {
    if (thumbnails.length <= displayCount) return thumbnails;
    const step = thumbnails.length / displayCount;
    return Array.from({ length: displayCount }, (_, i) =>
      thumbnails[Math.min(thumbnails.length - 1, Math.floor(i * step))]
    );
  }, [thumbnails, displayCount]);

  useEffect(() => {
    if (!videoUrl) return;

    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = videoUrl;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const frames: string[] = [];

    // Sampled against the *video's* own duration, not the transcription's.
    // They can disagree (a restored transcript alongside a different video, or
    // a transcript covering only part of the clip), and when they do the strip
    // drew thumbnails from the wrong span of footage yet spread them across
    // the full width — the worst kind of wrong, because it looks plausible.
    // `videoDuration` is filled in on loadedmetadata below.
    let videoDuration = 0;
    let frameCount = MIN_FILMSTRIP_FRAMES;

    // Publish as we go instead of only at the end. A long clip needs many
    // seeks, and holding every frame back until the last one left the timeline
    // blank for the whole build.
    let lastPublish = 0;
    const publish = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastPublish < FILMSTRIP_PUBLISH_MS) return;
      lastPublish = now;
      setFilmstrip({ url: videoUrl, frames: [...frames], count: frameCount });
    };

    const draw = () => {
      if (cancelled || !ctx || frames.length >= frameCount) return;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        // Capture the *whole* frame at the source's own aspect ratio, at 2x the
        // lane height. Forcing a landscape canvas center-cropped a portrait
        // source down to a thin horizontal band (32% of frame height for 9:16)
        // that could slice the subject out — and `bg-cover` then cropped that
        // band a second time to the cell aspect, compounding the smear.
        const aspect = video.videoWidth / video.videoHeight;
        canvas.height = FILMSTRIP_HEIGHT * 2;
        canvas.width = Math.max(
          48,
          Math.min(400, Math.round(canvas.height * aspect))
        );
        ctx.drawImage(
          video,
          0,
          0,
          video.videoWidth,
          video.videoHeight,
          0,
          0,
          canvas.width,
          canvas.height
        );
      }
      frames.push(canvas.toDataURL("image/jpeg", FILMSTRIP_QUALITY));
      publish(false);
      captureAt(frames.length);
    };

    // Wait for the frame at the new position to be readable, then draw.
    //
    // Two things this must not do:
    //
    // 1. Gate on requestVideoFrameCallback. It only resolves when the compositor
    //    *presents* a frame, which never happens for a video that is paused and
    //    merely seeked — measured on a 640s file: readyState 4 (data fully
    //    loaded) with the callback never invoked. The capture loop is
    //    sequential, so that stranded it on frame 0 and the filmstrip came out
    //    empty. 'seeked' does fire and is the primary signal here; the timeout
    //    is the backstop for a browser that delivers neither.
    // 2. Wait on requestAnimationFrame. rAF is throttled to near-zero in a
    //    background tab, so an rAF-based wait stalls for any user who switches
    //    tabs while the strip is building. A macrotask yields just as well and
    //    still lets the decoder flush the seeked frame.
    const awaitFrame = (onReady: () => void) => {
      let settled = false;
      const finish = () => {
        if (settled || cancelled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener("seeked", finish);
        // A single macrotask yield wasn't enough settle time on a real 60fps
        // 1080p file (twice the frames to flush per keyframe interval versus
        // the 24-30fps clips this was verified against) — 'seeked' had fired
        // but the compositor hadn't finished presenting the correct frame
        // yet, producing the same torn/streaked captures this function
        // exists to avoid. Two macrotask turns plus a short wall-clock delay
        // gives a demanding decode more room without reintroducing rAF's
        // background-tab stall.
        setTimeout(() => setTimeout(onReady, 30), 0);
      };
      const timer = setTimeout(finish, FILMSTRIP_FRAME_WAIT_MS);
      // Registered before the seek that triggers it, or the event is missed.
      video.addEventListener("seeked", finish);
    };

    const captureAt = (i: number) => {
      if (cancelled) return;
      if (i >= frameCount) {
        publish(true);
        return;
      }
      // Yield between frames so a long capture never saturates the main
      // thread and locks up scrubbing, typing, or playback.
      setTimeout(() => {
        if (cancelled) return;
        awaitFrame(draw);
        video.currentTime = (videoDuration * (i + 0.5)) / frameCount;
      }, 0);
    };

    video.addEventListener("loadedmetadata", () => {
      const d = video.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      videoDuration = d;
      // One thumbnail per FILMSTRIP_TARGET_SEC of runtime, bounded at both ends.
      // Always capture at this full density — zooming in should reveal more
      // of what's already there rather than triggering a re-seek pass, so
      // the on-screen cell-width clamp is applied only at display time
      // (see `displayCount` below), independent of how many frames exist.
      frameCount = Math.max(
        MIN_FILMSTRIP_FRAMES,
        Math.min(MAX_FILMSTRIP_FRAMES, Math.round(d / FILMSTRIP_TARGET_SEC))
      );
      captureAt(0);
    });

    return () => {
      cancelled = true;
      video.src = "";
    };
  }, [videoUrl]);

  return (
    <div className="w-full bg-zinc-800 border-t border-zinc-800 px-4 py-3">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-1 relative">
          <SearchIcon className="w-3 h-3 text-zinc-500 absolute left-2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setMatchIndex(0);
              visitedMatchRef.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!visitedMatchRef.current) {
                  visitedMatchRef.current = true;
                  jumpToMatch(matchIndex);
                } else if (e.shiftKey) {
                  jumpToMatch(matchIndex - 1);
                } else {
                  jumpToMatch(matchIndex + 1);
                }
              } else if (e.key === "Escape") {
                setSearchQuery("");
                setMatchIndex(0);
                visitedMatchRef.current = false;
              }
            }}
            placeholder="Find word..."
            title="Find a word in the transcript"
            className="w-28 pl-6 pr-1.5 py-1 text-xs bg-zinc-700 text-white rounded-lg border border-zinc-600 focus:border-[#00FF66] focus:outline-none placeholder:text-zinc-500"
          />
          {searchQuery.trim() && (
            <>
              <span className="text-[10px] text-zinc-400 font-mono whitespace-nowrap px-1">
                {searchMatches.length > 0 ? `${matchIndex + 1}/${searchMatches.length}` : "0/0"}
              </span>
              <button
                type="button"
                onClick={() => jumpToMatch(matchIndex - 1)}
                disabled={searchMatches.length === 0}
                title="Previous match"
                className="w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 rounded hover:bg-zinc-700"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => jumpToMatch(matchIndex + 1)}
                disabled={searchMatches.length === 0}
                title="Next match"
                className="w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 rounded hover:bg-zinc-700"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setMatchIndex(0);
                  visitedMatchRef.current = false;
                }}
                title="Clear search"
                className="w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-white rounded hover:bg-zinc-700"
              >
                ✕
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
            title="Zoom out"
            className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-white rounded hover:bg-zinc-700"
          >
            <MagnifyIcon sign="-" />
          </button>
          <input
            type="range"
            min={1}
            max={4}
            step={0.5}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-24"
            title="Timeline zoom"
            style={sliderFillStyle(zoom, 1, 4)}
          />
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, +(z + 0.5).toFixed(1)))}
            title="Zoom in"
            className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-white rounded hover:bg-zinc-700"
          >
            <MagnifyIcon sign="+" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="text-[10px] px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
          >
            Fit
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
      <div style={{ width: `${zoom * 100}%` }}>
      <div
        ref={containerRef}
        onClick={handleClick}
        onMouseDown={handleBackgroundMouseDown}
        className={`relative h-16 rounded-lg cursor-crosshair overflow-hidden ${
          displayedThumbnails.length > 0 ? "bg-black" : "bg-zinc-800"
        }`}
      >
        {displayedThumbnails.length > 0 && (
          <div className="absolute inset-0 flex">
            {displayedThumbnails.map((src, i) => (
              <div
                key={i}
                // Consecutive frames from a mostly-static shot (a talking
                // head barely moving between samples) are nearly identical.
                // Butted edge-to-edge with zero seam, a run of those reads
                // as a moiré/interlaced comb rather than as distinct
                // pictures — every capture is correct, but the eye can't
                // tell where one thumbnail ends and the next begins. A
                // border between cells breaks that illusion outright; every
                // mainstream editor's filmstrip does the same for the same
                // reason.
                className="bg-cover bg-center bg-no-repeat shrink-0 h-full border-r border-black/50 last:border-r-0"
                style={{
                  backgroundImage: `url(${src})`,
                  // Fixed per-cell width against the displayed count, so a
                  // partially-built strip fills in left to right instead of
                  // rescaling every thumbnail on each publish.
                  width: `${100 / displayCount}%`,
                }}
              />
            ))}
          </div>
        )}
        {rangeSel && (
          <div
            className="absolute top-0 bottom-0 bg-blue-500/25 border-x border-blue-400/70 pointer-events-none"
            style={{
              left: `${Math.min(rangeSel.a, rangeSel.b) * 100}%`,
              width: `${Math.abs(rangeSel.b - rangeSel.a) * 100}%`,
            }}
          />
        )}
        {wordPositions.map((w, i) => {
          const prevEnd = i > 0 ? wordPositions[i - 1].end : 0;
          const nextStart = i < wordPositions.length - 1 ? wordPositions[i + 1].start : duration;
          return (
            <div
              key={w.id}
              data-word-block
              data-word-id={w.id}
              onClick={(e) => {
                e.stopPropagation();
                selectWord(w.id, e.metaKey || e.ctrlKey);
                // Seek to the exact point clicked (not w.start) — the click
                // landed inside this word's own block, so it's already
                // within [w.start, w.end], which keeps the word visible in
                // the preview without snapping the playhead away from where
                // the user actually clicked.
                if (containerRef.current && duration) {
                  const rect = containerRef.current.getBoundingClientRect();
                  const pct = (e.clientX - rect.left) / rect.width;
                  setCurrentTime(pct * duration);
                }
              }}
              className={`
                absolute top-1 bottom-1 rounded-sm cursor-pointer transition-opacity
                ${
                  selectedWordIds.includes(w.id)
                    ? "bg-blue-500/60 opacity-100"
                    : "bg-zinc-600/50 hover:bg-zinc-500/60 opacity-70"
                }
                ${
                  matchIds.has(w.id)
                    ? searchMatches[matchIndex]?.id === w.id
                      ? "ring-2 ring-amber-300"
                      : "ring-1 ring-amber-400/70"
                    : ""
                }
              `}
              style={{
                left: `${w.startPct}%`,
                width: `${Math.max(w.widthPct, 0.3)}%`,
              }}
              title={w.text}
            >
              {/* Left edge handle */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 hover:bg-[#00FF66]/60 transition-colors rounded-l-sm"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const rect = containerRef.current!.getBoundingClientRect();
                  const startX = e.clientX;
                  const startVal = w.start;
                  const move = (ev: MouseEvent) => {
                    const dx = ev.clientX - startX;
                    const dt = (dx / rect.width) * duration;
                    const newStart = Math.min(Math.max(startVal + dt, prevEnd), w.end - 0.05);
                    retimeWord(w.id, newStart, w.end);
                  };
                  const up = () => {
                    window.removeEventListener("mousemove", move);
                    window.removeEventListener("mouseup", up);
                  };
                  window.addEventListener("mousemove", move);
                  window.addEventListener("mouseup", up);
                }}
              />
              {/* Right edge handle */}
              <div
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 hover:bg-[#00FF66]/60 transition-colors rounded-r-sm"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const rect = containerRef.current!.getBoundingClientRect();
                  const startX = e.clientX;
                  const startVal = w.end;
                  const move = (ev: MouseEvent) => {
                    const dx = ev.clientX - startX;
                    const dt = (dx / rect.width) * duration;
                    const newEnd = Math.max(Math.min(startVal + dt, nextStart), w.start + 0.05);
                    retimeWord(w.id, w.start, newEnd);
                  };
                  const up = () => {
                    window.removeEventListener("mousemove", move);
                    window.removeEventListener("mouseup", up);
                  };
                  window.addEventListener("mousemove", move);
                  window.addEventListener("mouseup", up);
                }}
              />
            </div>
          );
        })}

        <div
          data-playhead
          onMouseDown={handlePlayheadMouseDown}
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 cursor-ew-resize"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
        </div>
      </div>

      {showSfxLane && (
        <div className="mt-1.5">
          <div
            ref={sfxTrackRef}
            onClick={(e) => {
              if (!sfxTrackRef.current || !duration) return;
              const rect = sfxTrackRef.current.getBoundingClientRect();
              const x = e.clientX - rect.left;
              setCurrentTime(Math.max(0, (x / rect.width) * duration));
            }}
            className="relative h-4 bg-zinc-700/60 rounded cursor-crosshair overflow-hidden"
          >
            {sfxPositions.map(({ ev, startPct, widthPct }) => (
              <button
                key={ev.id}
                type="button"
                title={`${ev.sound.replace(/-/g, " ")} · ${ev.role}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentTime(ev.start);
                }}
                className={`
                  absolute top-0.5 bottom-0.5 rounded-sm
                  ${sfxRoleColor[ev.role] || "bg-zinc-500"} opacity-80
                  hover:opacity-100 hover:ring-1 hover:ring-white/60 transition-all
                `}
                style={{ left: `${startPct}%`, width: `${widthPct}%` }}
              />
            ))}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
              style={{ left: `${playheadPct}%` }}
            />
            <div className="absolute right-0 top-0 px-1.5 text-[9px] text-zinc-500 bg-zinc-900/70 rounded-bl">
              SFX · {sfxPack} · {sfxEvents.length}
            </div>
          </div>
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={2}>
      <circle cx="10.5" cy="10.5" r="6.5" strokeLinecap="round" />
      <path d="M20 20l-4.35-4.35" strokeLinecap="round" />
    </svg>
  );
}

function MagnifyIcon({ sign }: { sign: "+" | "-" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2}>
      <circle cx="10.5" cy="10.5" r="6.5" strokeLinecap="round" />
      <path d="M20 20l-4.35-4.35" strokeLinecap="round" />
      <path d={sign === "+" ? "M10.5 7.5v6M7.5 10.5h6" : "M7.5 10.5h6"} strokeLinecap="round" />
    </svg>
  );
}
