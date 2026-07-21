/* FindingDetailPanel — the AC-17 finding detail.

   It renders the EXISTING `FindingCard` from the PR route rather than a new
   detail view. `FindingCard` needs a full `FindingRecord` (confidence,
   suggestion, accepted_at, dismissed_at) while `AgentColumnFinding` is a
   deliberately narrow subset that the spec forbids widening — so the full
   record is obtained by a client-side JOIN on the finding `id` against the
   existing `GET /pulls/:id/reviews` payload (`usePrReviews`). Same
   client-side-join-over-contract-edit call SmartDiff made.

   That join is also why Accept/Dismiss need no extra plumbing: `useFindingAction`
   invalidates `["reviews", prId]`, which IS the cache this join reads, so the
   new accepted/dismissed state renders without a manual refresh (AC-18). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { IconBtn } from "@devdigest/ui";
import { FindingCard, type FindingCardAction } from "@/features/reviews/components/FindingCard/FindingCard";
import { usePrReviews, useFindingAction } from "@/lib/hooks/reviews";
import { s } from "./styles";

export function FindingDetailPanel({
  prId,
  findingId,
  repoFullName,
  headSha,
  onClose,
}: {
  prId: string;
  findingId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("runs");
  const { data: reviews, isLoading } = usePrReviews(prId);
  const action = useFindingAction();

  // AC-12/AC-18: the join is by finding id, so the record that comes back is
  // exactly the one agent's finding — acting on it can never touch a co-located
  // finding from another agent.
  const record = React.useMemo(
    () => (reviews ?? []).flatMap((r) => r.findings).find((f) => f.id === findingId) ?? null,
    [reviews, findingId],
  );

  /**
   * AC-19: `FindingCard` has ONE unified handler and AC-18 forces it to be
   * passed, so inertness is expressed HERE — everything that is not
   * accept/dismiss returns immediately: no request, no state change, no toast.
   * That is what makes "Turn into eval case" (and any future action literal) a
   * placeholder on this page while remaining live on the PR page.
   */
  const handleAction = (act: FindingCardAction) => {
    if (act !== "accept" && act !== "dismiss") return;
    action.mutate({ findingId, action: act, prId });
  };

  return (
    <section style={s.panel} data-testid="finding-detail">
      <div style={s.closeRow}>
        <IconBtn icon="X" label={t("page.finding.close")} onClick={onClose} />
      </div>
      {record ? (
        <FindingCard
          f={record}
          defaultExpanded
          pending={action.isPending}
          repoFullName={repoFullName}
          headSha={headSha}
          onAction={handleAction}
        />
      ) : (
        // Never a crash and never a blank area: the reviews payload may not
        // have loaded yet, or the id may be absent from it.
        <div style={s.fallback}>
          {isLoading ? t("page.finding.loading") : t("page.finding.unavailable")}
        </div>
      )}
    </section>
  );
}
