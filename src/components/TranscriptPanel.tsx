"use client";

import { useState, useRef, useEffect, memo } from "react";
import { useEditorStore } from "@/store/editor-store";
import EditableWord from "@/components/EditableWord";
import { DictionaryEntry } from "@/core/types";
import { isSingleToken } from "@/core/dictionary";

// Numbers and other detail-heavy tokens are what speech-to-text gets wrong
// most often — highlighting them draws the eye to what's worth double-checking.
const NOTABLE_WORD = /\d/;

// Maps a flat character offset into a space-joined sentence back to which
// space-separated word it falls within (clamped to the last word if the
// offset lands past the end, e.g. a click in trailing whitespace).
function charOffsetToWordIndex(text: string, offset: number): number {
  const parts = text.split(" ");
  let acc = 0;
  for (let i = 0; i < parts.length; i++) {
    acc += parts[i].length;
    if (offset <= acc) return i;
    acc += 1; // the joining space
  }
  return parts.length - 1;
}

export default function TranscriptPanel({ onClose }: { onClose?: () => void }) {
  const transcription = useEditorStore((s) => s.project.transcription);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const selectWord = useEditorStore((s) => s.selectWord);
  const setSelectedWords = useEditorStore((s) => s.setSelectedWords);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const updateWordText = useEditorStore((s) => s.updateWordText);
  const dictionary = useEditorStore((s) => s.project.dictionary);
  const addDictionaryEntry = useEditorStore((s) => s.addDictionaryEntry);
  const removeDictionaryEntry = useEditorStore((s) => s.removeDictionaryEntry);
  const [editMode, setEditMode] = useState(false);
  const [showDictionary, setShowDictionary] = useState(false);

  if (!transcription) return null;

  return (
    <div className="w-full min-w-0 h-full flex flex-col border-l border-zinc-800 bg-zinc-900 overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-800 shrink-0 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Transcript</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {transcription.words.length} words ·{" "}
            {editMode ? "click anywhere and type" : "click to jump — pencil to edit"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowDictionary((v) => !v)}
            title="Dictionary — fix words your video keeps mishearing"
            className={`px-1.5 h-6 flex items-center justify-center rounded text-[10px] font-medium transition-colors ${
              showDictionary ? "bg-[#00FF66] text-black" : "text-zinc-500 hover:text-white"
            }`}
          >
            Dictionary{dictionary.length > 0 ? ` (${dictionary.length})` : ""}
          </button>
          <button
            onClick={() => setEditMode((v) => !v)}
            title={editMode ? "Editing on — click to turn off" : "Turn on editing"}
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
              editMode ? "bg-[#00FF66] text-black" : "text-zinc-500 hover:text-white"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5">
              <path
                d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {onClose && (
            <button onClick={onClose} title="Hide panel" className="text-zinc-500 hover:text-white">
              ✕
            </button>
          )}
        </div>
      </div>
      {showDictionary && (
        <DictionarySection
          entries={dictionary}
          onAdd={addDictionaryEntry}
          onRemove={removeDictionaryEntry}
        />
      )}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {transcription.captionGroups.map((group) => {
          const isActive = currentTime >= group.start && currentTime <= group.end;
          // "Selected" at the sentence level = every word in this group is
          // currently selected — a plain click on any word in the sentence
          // selects the whole group (see onSelect below), so this reads as
          // "this sentence" rather than "this one word" in the common case.
          const isSentenceSelected =
            group.wordIds.length > 0 && group.wordIds.every((wid) => selectedWordIds.includes(wid));
          const groupWords = group.wordIds
            .map((wid) => transcription.words.find((w) => w.id === wid))
            .filter((w): w is NonNullable<typeof w> => !!w);

          return (
            <div
              key={group.id}
              className={`pl-2.5 py-1 -my-1 border-l-2 rounded-r transition-colors ${
                isActive ? "border-[#00FF66]" : "border-transparent"
              } ${isSentenceSelected ? "bg-blue-500/10" : ""}`}
            >
              {editMode ? (
                <EditableSentence
                  key={group.id}
                  words={groupWords}
                  onCommitWords={(newTexts) => {
                    groupWords.forEach((w, i) => {
                      if (newTexts[i] !== undefined && newTexts[i] !== w.text) {
                        updateWordText(w.id, newTexts[i]);
                      }
                    });
                  }}
                  onSeekWord={(word) => {
                    setCurrentTime(word.start);
                    setSelectedWords(group.wordIds);
                  }}
                />
              ) : (
                <p className="text-sm leading-relaxed">
                  {groupWords.map((word) => {
                    const isSelected = selectedWordIds.includes(word.id);
                    const isNotable = NOTABLE_WORD.test(word.text);
                    return (
                      <span key={word.id}>
                        <EditableWord
                          text={word.text}
                          editable={false}
                          onSelect={(e) => {
                            if (e.metaKey || e.ctrlKey) {
                              // Power-user path: fine-grained multi-word select,
                              // unchanged from before.
                              setCurrentTime(word.start);
                              selectWord(word.id, true);
                            } else {
                              // Plain click: seek to the exact word clicked (not
                              // just the sentence's start — clicking the 4th
                              // word of a long sentence should land on the 4th
                              // word, not snap back to the 1st), but still
                              // select every word in the sentence so the whole
                              // group highlights for context (which also lights
                              // up the matching range in the Timeline, since it
                              // colors blocks by the same selectedWordIds). The
                              // video naturally previews this group's captions
                              // once currentTime lands inside it.
                              setCurrentTime(word.start);
                              setSelectedWords(group.wordIds);
                            }
                          }}
                          onCommit={(t) => updateWordText(word.id, t)}
                          fieldName={`transcript-word-${word.id}`}
                          dataWordId={word.id}
                          className={`rounded px-0.5 transition-colors ${
                            isSelected
                              ? "bg-blue-500/30 text-blue-300"
                              : isNotable
                                ? "text-[#00FF66]"
                                : "text-zinc-200 hover:bg-zinc-800"
                          }`}
                        />{" "}
                      </span>
                    );
                  })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One continuous editable text surface per sentence, so clicking anywhere in
// it — not just on a specific word — places a real native cursor exactly
// there and lets you type/backspace freely, like a normal text field. On
// blur the resulting text is split back into words and mapped positionally
// onto the sentence's word ids. If the word count changed (a word was added
// or removed), the edit is NOT committed — splitting/merging words would
// leave some word with no timestamp, which the data model can't represent —
// the text reverts instead of silently corrupting timing data.
const EditableSentence = memo(function EditableSentence({
  words,
  onCommitWords,
  onSeekWord,
}: {
  words: { id: string; text: string; start: number }[];
  onCommitWords: (newTexts: string[]) => void;
  onSeekWord: (word: { id: string; text: string; start: number }) => void;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const isFocusedRef = useRef(false);
  const text = words.map((w) => w.text).join(" ");

  // Keep the DOM in sync with the store, but never while the user is
  // actively typing in it — React doesn't track contentEditable's live DOM
  // mutations, so re-syncing mid-edit would reset the cursor and discard
  // whatever hasn't been committed yet.
  useEffect(() => {
    if (ref.current && !isFocusedRef.current && ref.current.textContent !== text) {
      ref.current.textContent = text;
    }
  }, [text]);

  return (
    <p
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onClick={(e) => {
        // Being editable doesn't mean seeking should stop working — figure
        // out which word the click's caret position landed nearest to (by
        // flat character offset into this sentence's text) and seek there,
        // same as a plain click does outside edit mode.
        const doc = e.currentTarget.ownerDocument;
        // Older Firefox (pre-150) exposes only caretPositionFromPoint, not
        // caretRangeFromPoint; newer ones expose both. Try the standard API
        // first and normalize both shapes into {container, offset}.
        const caretDoc = doc as unknown as {
          caretPositionFromPoint?: (x: number, y: number) => {
            offsetNode: Node | null;
            offset: number;
          } | null;
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        let container: Node | null = null;
        let startOffset = 0;
        const pos = caretDoc.caretPositionFromPoint?.call(doc, e.clientX, e.clientY);
        if (pos?.offsetNode) {
          container = pos.offsetNode;
          startOffset = pos.offset;
        } else {
          const range = caretDoc.caretRangeFromPoint?.call(doc, e.clientX, e.clientY);
          if (range) {
            container = range.startContainer;
            startOffset = range.startOffset;
          }
        }
        if (!container || !ref.current?.contains(container)) return;

        let offset = 0;
        const walker = document.createTreeWalker(ref.current, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let found = false;
        while (node) {
          if (node === container) {
            offset += startOffset;
            found = true;
            break;
          }
          offset += node.textContent?.length ?? 0;
          node = walker.nextNode();
        }
        if (!found) return;

        const wordIndex = charOffsetToWordIndex(text, offset);
        if (words[wordIndex]) onSeekWord(words[wordIndex]);
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        const newText = ref.current?.textContent ?? "";
        const newWords = newText.trim().split(/\s+/).filter(Boolean);
        if (newWords.length === words.length) {
          onCommitWords(newWords);
        } else if (ref.current) {
          // Word count changed — revert rather than corrupt the timing model.
          ref.current.textContent = text;
        }
      }}
      className="text-sm leading-relaxed text-zinc-200 outline-none rounded px-1 -mx-1 focus:bg-zinc-800/60 focus:ring-1 focus:ring-[#00FF66]/50 whitespace-pre-wrap"
    >
      {text}
    </p>
  );
});

// Corrections apply on every future transcription of this project: as a
// vocabulary hint sent to Whisper up front, and as a guaranteed find-replace
// pass on the result (see src/core/dictionary.ts). Kept collapsed by default
// — most projects never need it, and it shouldn't compete with the transcript
// for attention when it's empty.
function DictionarySection({
  entries,
  onAdd,
  onRemove,
}: {
  entries: DictionaryEntry[];
  onAdd: (from: string, to: string) => void;
  onRemove: (id: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [validation, setValidation] = useState<string | null>(null);

  const submit = () => {
    const f = from.trim();
    const t = to.trim();
    if (!f || !t) {
      setValidation("Enter both the mis-heard word and the correction.");
      return;
    }
    if (!isSingleToken(f) || !isSingleToken(t)) {
      setValidation("Each entry fixes one word — use a single word on both sides.");
      return;
    }
    setValidation(null);
    onAdd(f, t);
    setFrom("");
    setTo("");
  };

  return (
    <div className="px-4 py-3 border-b border-zinc-800 shrink-0 space-y-2 bg-zinc-950/40">
      <p className="text-[10px] text-zinc-500">
        Words this video keeps mishearing → what they should say. Applies to future transcriptions in this project.
      </p>
      {entries.length > 0 && (
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500 truncate">{e.from}</span>
              <span className="text-zinc-600">→</span>
              <span className="text-white truncate flex-1">{e.to}</span>
              <button
                onClick={() => onRemove(e.id)}
                title="Remove"
                className="text-zinc-500 hover:text-red-400 shrink-0"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {validation && (
        <p role="status" className="text-[10px] text-red-400">
          {validation}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <input
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setValidation(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="mis-heard as..."
          className="min-w-0 flex-1 bg-zinc-800 text-xs text-white rounded px-2 py-1 outline-none focus:ring-1 focus:ring-[#00FF66]/50"
        />
        <input
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setValidation(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="should say..."
          className="min-w-0 flex-1 bg-zinc-800 text-xs text-white rounded px-2 py-1 outline-none focus:ring-1 focus:ring-[#00FF66]/50"
        />
        <button
          onClick={submit}
          className="shrink-0 px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-xs rounded"
        >
          Add
        </button>
      </div>
    </div>
  );
}
