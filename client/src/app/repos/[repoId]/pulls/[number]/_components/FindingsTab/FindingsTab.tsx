"use client";

import React, { useCallback } from "react";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import { RunStatus } from "../RunStatus/RunStatus";
import { RunHistory } from "../RunHistory/RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion/ReviewRunAccordion";
import { s } from "./styles";
import { FindingTargetContext } from "../../_lib/findingTarget.context";
import type { FindingRecord, ReviewRecord, RunSummary, PrCommit } from "@devdigest/shared";
import type { UseMutationResult } from "@tanstack/react-query";

interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  runs: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  cancelMutation: UseMutationResult<any, any, string, any>;
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  /** Smart-Diff deep-link target (from page.tsx's `?findingId=` search param +
   *  in-memory nonce) — resolved here to the owning run, then fed into the
   *  EXISTING `targetRunId`/`targetNonce` mechanism of `ReviewRunAccordion`. */
  findingId?: string | null;
  nonce?: number;
  /** Called once the `findingId` target is resolved + revealed, so the parent
   *  can strip `?findingId` from the URL (it has done its job). */
  onFindingConsumed?: () => void;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
  onRunDone: () => void;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  prRuns,
  prCommits,
  cancelMutation,
  repoFullName,
  headSha,
  findingId = null,
  nonce = 0,
  onFindingConsumed,
  onOpenTrace,
  onDelete,
  onRunDone,
}: FindingsTabProps) {
  const handleCancelAll = useCallback(() => {
    liveRunIds.forEach((id) => cancelMutation.mutate(id));
  }, [liveRunIds, cancelMutation]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  const handleOpenTrace = useCallback(
    (id: string) => {
      onOpenTrace(id);
    },
    [onOpenTrace],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

  // Timeline → Review-runs navigation: clicking an agent name in the timeline
  // opens + scrolls to that run's accordion below. The nonce re-triggers the
  // scroll even when the same run is clicked twice.
  const [target, setTarget] = React.useState<{ runId: string; n: number } | null>(null);
  const handleGoToReview = useCallback((runId: string) => {
    setTarget((p) => ({ runId, n: (p?.n ?? 0) + 1 }));
  }, []);

  // Findings indexed by run_id so the timeline can show a per-run severity
  // breakdown (the inline ⊘N ⚠N 💡N cluster) without an extra fetch — reviews
  // are already loaded for the Review runs section.
  const findingsByRunId = React.useMemo(() => {
    const m = new Map<string, FindingRecord[]>();
    for (const r of runs) {
      if (r.run_id) m.set(r.run_id, r.findings);
    }
    return m;
  }, [runs]);

  // Smart-Diff deep-link resolution: findingId -> finding.review_id ->
  // review.id -> review.run_id (a finding carries no run_id of its own).
  const resolvedTargetRunId = React.useMemo(() => {
    if (!findingId) return null;
    const finding = runs.flatMap((r) => r.findings).find((f) => f.id === findingId);
    if (!finding) return null;
    const review = runs.find((r) => r.id === finding.review_id);
    return review?.run_id ?? null;
  }, [findingId, runs]);

  // Feed the resolved run into the SAME `targetRunId`/`targetNonce` the Timeline
  // uses (`handleGoToReview` above) — reuses ReviewRunAccordion's existing
  // force-open+scroll, no new accordion mechanism. Computed directly during
  // render (not via a `useEffect` + `setTarget`) so ReviewRunAccordion sees the
  // resolved run in the SAME commit as FindingCard sees its `targetFindingId`.
  // An extra render round trip here would let ReviewRunAccordion's own
  // scrollIntoView (to its accordion root) fire a whole render AFTER
  // FindingCard's precise scroll to the specific finding, clobbering it —
  // always landing on the accordion's default-expanded first card instead.
  const effectiveTargetRunId = resolvedTargetRunId ?? target?.runId ?? null;
  const effectiveTargetNonce = resolvedTargetRunId ? nonce : target?.n ?? 0;

  // Strip ?findingId from the URL once the target run is resolved+revealed.
  // Small delay so a FindingCard in an accordion that only just opened has
  // mounted and consumed the target (via FindingTargetContext) before the
  // param clears — clearing it does NOT collapse/unhighlight the card (that
  // state is internal + one-way), it just tidies the URL.
  React.useEffect(() => {
    if (resolvedTargetRunId) {
      const timer = setTimeout(() => onFindingConsumed?.(), 600);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findingId, nonce, resolvedTargetRunId]);

  return (
    <section>
      {liveRunIds.length > 0 && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancelMutation.isPending}
                  onClick={handleCancelAll}
                >
                  Cancel
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  Open run trace
                </Button>
              </div>
            }
          >
            Live review
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunDone} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.reviewInProgressText}>Review in progress…</span>
          <span style={s.reviewInProgressSub}>
            the agent is analyzing the diff — this can take a while on large PRs.
          </span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
          <span style={s.lethalTrifectaTitle}>Lethal Trifecta detected</span>
          <Badge color="var(--crit)" bg="transparent">
            {lethalTrifecta.length} finding(s)
          </Badge>
        </div>
      )}

      {((prRuns && prRuns.length > 0) || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel
            icon="Activity"
            right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>runs &amp; commits · newest first</span>}
          >
            Timeline
          </SectionLabel>
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRunId={findingsByRunId}
            onOpenTrace={handleOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={handleDelete}
          />
        </div>
      )}

      <SectionLabel
        icon="AlertOctagon"
        right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>grouped by run · newest first</span>}
      >
        Review runs
      </SectionLabel>
      {runs.length === 0 ? (
        reviewRunning || liveRunIds.length > 0 ? null : (
          <EmptyState
            icon="Sparkles"
            title="No findings yet"
            body="Run a review to generate findings. Use Run Review ▾ above (run all enabled agents or a specific one)."
          />
        )
      ) : (
        prId && (
          <FindingTargetContext.Provider value={{ id: findingId, nonce }}>
            {runs.map((review, i) => (
              <ReviewRunAccordion
                key={review.id}
                review={review}
                run={prRuns?.find((r) => r.run_id === review.run_id) ?? null}
                prId={prId}
                defaultOpen={i === 0}
                repoFullName={repoFullName}
                headSha={headSha}
                targetRunId={effectiveTargetRunId}
                targetNonce={effectiveTargetNonce}
              />
            ))}
          </FindingTargetContext.Provider>
        )
      )}
    </section>
  );
}
