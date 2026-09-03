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
}

export default function EditableWord({
  text,
  onSelect,
  onCommit,
  style,
  className = "",
  inputClassName = "",
  fieldName = "word",
}: EditableWordProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

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
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(text);
        setEditing(true);
      }}
      style={style}
      className={className}
      title="Double-click to edit this word"
    >
      {text}
    </span>
  );
}
