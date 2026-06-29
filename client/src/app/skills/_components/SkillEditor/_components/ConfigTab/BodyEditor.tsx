/* BodyEditor — textarea with a gutter of line numbers overlaid in a sibling
   div. The two share the same line-height + font so the gutter tracks the
   textarea exactly when the user scrolls. Zero deps. */
"use client";

import React from "react";

const FONT_FAMILY = "var(--font-mono)";
const FONT_SIZE = 13;
const LINE_HEIGHT = 20;
const GUTTER_WIDTH = 44;

interface BodyEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Min visible rows; the textarea autosizes to its content above that. */
  minRows?: number;
}

export function BodyEditor({
  value,
  onChange,
  placeholder,
  minRows = 14,
}: BodyEditorProps) {
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  // Lines for the gutter — derived from `value`. Always at least minRows so
  // the editor doesn't shrink visually when empty.
  const lineCount = Math.max(value.split("\n").length, minRows);
  const lines = React.useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1),
    [lineCount],
  );

  // Keep gutter scroll in sync with the textarea — manual since the textarea
  // owns the scrollbar.
  const onScroll = () => {
    if (taRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  return (
    <div
      style={{
        display: "flex",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-surface)",
        overflow: "hidden",
      }}
    >
      <div
        ref={gutterRef}
        aria-hidden
        style={{
          width: GUTTER_WIDTH,
          padding: "10px 6px",
          textAlign: "right",
          color: "var(--text-muted)",
          background: "var(--bg-secondary)",
          borderRight: "1px solid var(--border)",
          fontFamily: FONT_FAMILY,
          fontSize: FONT_SIZE,
          lineHeight: `${LINE_HEIGHT}px`,
          overflow: "hidden",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        {lines.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={onScroll}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          flex: 1,
          minHeight: minRows * LINE_HEIGHT + 20,
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text-primary)",
          fontFamily: FONT_FAMILY,
          fontSize: FONT_SIZE,
          lineHeight: `${LINE_HEIGHT}px`,
          resize: "vertical",
        }}
      />
    </div>
  );
}

/**
 * Cheap token-count approximation (~4 chars per token). Real tiktoken runs
 * server-side; for the live "166 tokens" badge we just want a rough number
 * that updates as the user types without bundling a 2MB BPE table.
 */
export function approxTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.round(text.length / 4));
}
