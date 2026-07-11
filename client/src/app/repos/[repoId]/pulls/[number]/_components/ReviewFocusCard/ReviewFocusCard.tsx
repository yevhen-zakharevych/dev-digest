/* ReviewFocusCard — Why+Risk Brief (L06) "Review focus — read these first"
   block. Split OUT of `PrBriefCard` (that card is now a compact horizontal
   banner, no list) into its own standalone bottom-of-Overview section, per
   the design mockup. Reads `usePrBrief(prId)` — the SAME `["brief", prId]`
   TanStack Query key as `PrBriefCard`, so the two cards dedupe onto one
   fetch/cache entry rather than double-requesting the brief.

   Each item is a keyboard-operable in-app control (`MonoLink` used as a
   button — no `href`) that opens the file IN-APP (switches the PR-detail tab
   to "Files changed" and scrolls to it, `onOpenFile`) rather than linking out
   to GitHub. Renders nothing when there is no brief yet, or the brief has no
   review_focus items — this block is purely additive, never an error state
   (the not_generated/degraded/loading states are all owned by PrBriefCard). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, SectionLabel } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks/brief";

export interface ReviewFocusCardProps {
  prId: string | number;
  /** Opens a review-focus file in-app: switches the PR-detail tab to "Files
   * changed" and scrolls to it (threaded from page.tsx's `handleOpenFile`). */
  onOpenFile: (file: string) => void;
}

export function ReviewFocusCard({ prId, onOpenFile }: ReviewFocusCardProps) {
  const t = useTranslations("brief");
  const { data } = usePrBrief(prId);
  const items = data?.brief?.review_focus ?? [];

  if (items.length === 0) return null;

  return (
    <section style={s.wrap} data-testid="review-focus-card">
      <SectionLabel icon="ListChecks" right={<Badge mono>{items.length}</Badge>}>
        {t("reviewFocus")}
      </SectionLabel>
      <ul style={s.list}>
        {items.map((item, i) => (
          <li key={`${item.file}:${item.line}:${i}`} style={s.item}>
            <button
              className="mono"
              onClick={() => onOpenFile(item.file)}
              style={s.link}
            >
              {item.file}:{item.line}
            </button>
            <span style={s.reason}> — {item.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: 14,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 14,
  } as React.CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } as React.CSSProperties,
  // One flowing line per item: an accent-colored file:line link followed
  // inline by the reason — no columns, the reason wraps under the text, not
  // into a second column.
  item: {
    fontSize: 13,
    lineHeight: 1.6,
  } as React.CSSProperties,
  link: {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 13,
    cursor: "pointer",
    color: "var(--accent-text)",
    textUnderlineOffset: 2,
  } as React.CSSProperties,
  reason: {
    color: "var(--text-secondary)",
  } as React.CSSProperties,
} as const;
