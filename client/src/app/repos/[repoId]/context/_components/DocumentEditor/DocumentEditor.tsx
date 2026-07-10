/* DocumentEditor — textarea with a sibling line-number gutter, for editing a
   discovered document's raw markdown in place (AC-31). Same zero-dependency
   pattern as the Skills body editor
   (`app/skills/_components/SkillEditor/_components/ConfigTab/BodyEditor.tsx`,
   documented at `client/INSIGHTS.md`): a `<textarea>` + a sibling gutter
   `<div>`, kept in sync on scroll. No CodeMirror/Monaco. This is a SEPARATE
   component (route-local to `context/`) rather than an import of the Skills
   one, which is owned by a different route. */
"use client";

import React from "react";

const FONT_FAMILY = "var(--font-mono)";
const FONT_SIZE = 13;
const LINE_HEIGHT = 20;
const GUTTER_WIDTH = 44;

export interface DocumentEditorProps {
  value: string;
  onChange: (v: string) => void;
  /** Min visible rows; the textarea autosizes to its content above that. */
  minRows?: number;
  "aria-label"?: string;
}

export function DocumentEditor({
  value,
  onChange,
  minRows = 12,
  "aria-label": ariaLabel,
}: DocumentEditorProps) {
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  const lineCount = Math.max(value.split("\n").length, minRows);
  const lines = React.useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1),
    [lineCount],
  );

  // The textarea owns the scrollbar; the gutter mirrors its scroll position.
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
        aria-label={ariaLabel}
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
