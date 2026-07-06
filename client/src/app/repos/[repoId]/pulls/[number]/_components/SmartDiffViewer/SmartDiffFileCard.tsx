/* SmartDiffFileCard — one collapsible file inside a SmartDiffViewer group.
   Renders the file's patch via the shared diff-viewer primitives (parsePatch +
   CodeLine, read-only — no inline commenting in smart order, see
   docs/plans/smart-diff.md §9 assumption 6). Findings affordances:
   - ONE SeverityBadge per finding, on the first diff line it covers (a multi-line
     finding gets a single badge, not one per line), that deep-links to the
     Findings tab; every line the finding spans gets left+right severity-colored
     accent bars;
   - a header "N findings" badge that expands the file and scrolls to the first
     finding line, in-place in the diff. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, type UISeverity } from "@devdigest/ui";
import type { SmartDiffFile, FindingRecord } from "@devdigest/shared";
import { parsePatch, type Line } from "@/components/diff-viewer/helpers";
import { CodeLine } from "@/components/diff-viewer/CodeLine/CodeLine";
import { AUTO_EXPAND_MAX_LINES } from "@/components/diff-viewer/constants";
import { s, chevronFor, lineBar } from "./styles";

/** Findings whose new-side line range contains this line's new-side number. */
function findingsForLine(findings: FindingRecord[], ln: Line): FindingRecord[] {
  if (ln.newNo == null) return [];
  return findings.filter((f) => ln.newNo! >= f.start_line && ln.newNo! <= f.end_line);
}

const SEV_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };
const SEV_LINE_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--accent)",
};

export function SmartDiffFileCard({
  file,
  patch,
  findings,
  onOpenFinding,
}: {
  file: SmartDiffFile;
  patch: string | null | undefined;
  /** Findings already scoped to this file's path. */
  findings: FindingRecord[];
  onOpenFinding: (findingId: string) => void;
}) {
  const t = useTranslations("prReview");
  const tShell = useTranslations("shell");
  const [open, setOpen] = React.useState(
    file.additions + file.deletions <= AUTO_EXPAND_MAX_LINES,
  );
  const lines = React.useMemo(() => parsePatch(patch), [patch]);

  // First rendered line carrying a finding — the scroll target for the
  // "N findings" badge (guaranteed to exist in the DOM, unlike a raw
  // start_line that may sit outside the diff's hunks).
  const firstFindingLineIndex = React.useMemo(
    () => lines.findIndex((ln) => findingsForLine(findings, ln).length > 0),
    [lines, findings],
  );
  // ONE badge per finding — placed on the first diff line the finding covers
  // (not one per line in its range) — plus a per-line severity color for the
  // left/right accent bars that mark every line the finding spans.
  const { badgesByLineIndex, barColorByLineIndex } = React.useMemo(() => {
    const badges = new Map<number, FindingRecord[]>();
    const colors = new Map<number, string>();
    const ranks = new Map<number, number>();
    for (const f of findings) {
      let firstIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i]!;
        if (ln.newNo == null || ln.newNo < f.start_line || ln.newNo > f.end_line) continue;
        if (firstIdx === -1) firstIdx = i;
        const rank = SEV_RANK[f.severity] ?? 0;
        if (rank > (ranks.get(i) ?? 0)) {
          ranks.set(i, rank);
          colors.set(i, SEV_LINE_COLOR[f.severity] ?? "var(--accent)");
        }
      }
      if (firstIdx >= 0) {
        const arr = badges.get(firstIdx);
        if (arr) arr.push(f);
        else badges.set(firstIdx, [f]);
      }
    }
    return { badgesByLineIndex: badges, barColorByLineIndex: colors };
  }, [lines, findings]);

  const firstFindingRef = React.useRef<HTMLDivElement>(null);
  const [pendingScroll, setPendingScroll] = React.useState(false);

  // Scroll only AFTER the body is in the DOM (setOpen may have just expanded it).
  React.useEffect(() => {
    if (pendingScroll && open) {
      firstFindingRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPendingScroll(false);
    }
  }, [pendingScroll, open]);

  // "N findings" badge → expand the file (if collapsed) and scroll to the first
  // finding line, in-place in the diff — distinct from a per-line severity badge,
  // which deep-links to the Findings tab. stopPropagation so the header's
  // collapse toggle doesn't also fire.
  const jumpToFirstFinding = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setOpen(true);
    if (firstFindingLineIndex >= 0) setPendingScroll(true);
  };

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {findings.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("smartDiff.jumpToFinding")}
            onClick={jumpToFirstFinding}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") jumpToFirstFinding(e);
            }}
            style={s.findingCount}
          >
            <Icon.AlertTriangle size={12} />
            {t("smartDiff.findingsCount", { count: findings.length })}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{tShell("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => {
              const badgeFindings = badgesByLineIndex.get(i) ?? [];
              const barColor = barColorByLineIndex.get(i);
              return (
                <div
                  key={i}
                  ref={i === firstFindingLineIndex ? firstFindingRef : undefined}
                  style={s.lineRow}
                >
                  {barColor && <div aria-hidden style={lineBar(barColor, "left")} />}
                  {barColor && <div aria-hidden style={lineBar(barColor, "right")} />}
                  <CodeLine ln={ln} path={file.path} threads={[]} />
                  {badgeFindings.length > 0 && (
                    <div style={s.lineBadges}>
                      {badgeFindings.map((f) => (
                        <span
                          key={f.id}
                          role="button"
                          tabIndex={0}
                          aria-label={f.title}
                          onClick={() => onOpenFinding(f.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onOpenFinding(f.id);
                            }
                          }}
                          style={s.badgeButton}
                        >
                          <SeverityBadge severity={f.severity as UISeverity} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
