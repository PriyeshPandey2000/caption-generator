"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

interface EditableWordProps {
  text: string;
  /** Called on single click so the host can select the word. */
  onSelect?: (e: ReactMouseEvent) => void;
  /** Called when the user commits an edit (Enter or blur). */
  onCommit: (newText: string) => void;
  /** Resolved style applied to both the static span and the edit input. */
  style?: CSSProperties;
  className?: string;
  /** Style applied only to the edit input (e.g. outline/highlight). */
  inputClassName?: string;
  /** Unique id so multiple editors on screen don't fight over focus. */
  fieldName?: string;
  /** Rendered as data-word-id so a marquee/rubber-band selection can hit-test this word. */
  dataWordId?: string;
  /** Whether double-click starts editing. Defaults to true; set false to make
   * this a click-to-select-only word (e.g. gated behind an edit-mode toggle). */
  editable?: boolean;
  /** When true (and editable), a single click starts editing directly instead
   * of requiring a double-click — for an explicit "edit mode" where every
   * click is already understood to mean "edit," not "select." */
  editOnSingleClick?: boolean;
}

export default function EditableWord({
  text,
  onSelect,
  onCommit,
  style,
  className = "",
  inputClassName = "",
  fieldName = "word",
  dataWordId,
  editable = true,
  editOnSingleClick = false,
}: EditableWordProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);
  // Approximate character offset under the click that opened the input, so
  // the cursor lands roughly where the user actually clicked instead of
  // select-all-ing the word (which reads as "did my click even register?").
  const clickOffsetRef = useRef<number | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const pos = clickOffsetRef.current ?? draft.length;
      inputRef.current.setSelectionRange(pos, pos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const startEditingAt = useCallback(
    (e: ReactMouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 1;
      clickOffsetRef.current = Math.round(Math.min(1, Math.max(0, ratio)) * text.length);
      setDraft(text);
      setEditing(true);
    },
    [text]
  );

  const commit = useCallback(() => {
    setEditing(false);
    onCommit(draft);
  }, [draft, onCommit]);

  const cancel = useCallback(() => {
    setDraft(text);
    setEditing(false);
  }, [text]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    },
    [commit, cancel]
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        name={fieldName}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{ ...style, minWidth: "1em", background: "transparent", outline: "none" }}
        className={`${inputClassName} ${className}`}
        aria-label="Edit caption word"
      />
    );
  }

  return (
    <span
      onClick={
        editable && editOnSingleClick
          ? (e) => {
              e.stopPropagation();
              startEditingAt(e);
            }
          : onSelect
      }
      onDoubleClick={
        editable && !editOnSingleClick
          ? (e) => {
              e.stopPropagation();
              startEditingAt(e);
            }
          : undefined
      }
      style={style}
      className={`cursor-pointer ${className}`}
      title={editable ? (editOnSingleClick ? "Click to edit this word" : "Double-click to edit this word") : undefined}
      data-word-id={dataWordId}
    >
      {text}
    </span>
  );
}
