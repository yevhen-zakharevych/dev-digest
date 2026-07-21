/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2) and, since L06, the "Turn into
   eval case" action (AC-1) through the SAME onAction path. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useSeedEvalCaseFromFinding } from "@/lib/hooks/evals";
import { FindingCard, type FindingCardAction } from "@/features/reviews/components/FindingCard/FindingCard";
import { FindingTargetContext } from "../../_lib/findingTarget.context";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  targetFindingId,
  targetNonce,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Smart-Diff deep-link target — id of the finding to force-expand +
   *  highlight in the matching `FindingCard`. Falls back to the
   *  `FindingTargetContext` (set by `FindingsTab`) when not passed explicitly,
   *  since the real render path is nested inside `ReviewRunAccordion`, which
   *  does not forward arbitrary props. */
  targetFindingId?: string | null;
  targetNonce?: number;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const toast = useToast();
  const action = useFindingAction();
  const seedEvalCase = useSeedEvalCaseFromFinding();
  const ctxTarget = React.useContext(FindingTargetContext);
  const effectiveTargetId = targetFindingId ?? ctxTarget.id;
  const effectiveTargetNonce = targetNonce ?? ctxTarget.nonce;
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const shown = React.useMemo(() => {
    const base = visibleFindings(findings, hideLow);
    // The deep-linked target must stay visible even if "hide low confidence"
    // would otherwise drop it (docs/plans/smart-diff.md §5 Deep-link).
    if (effectiveTargetId && !base.some((f) => f.id === effectiveTargetId)) {
      const target = findings.find((f) => f.id === effectiveTargetId);
      if (target) return [target, ...base];
    }
    return base;
  }, [findings, hideLow, effectiveTargetId]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  /**
   * Turn a decided finding into an eval case (AC-1). The server enforces
   * one case per source finding (AC-8) — invoking this twice always yields
   * ONE case; the second call resolves with `created: false` and we still
   * navigate to that existing case rather than silently no-op'ing.
   */
  const handleSeedEvalCase = (findingId: string) => {
    seedEvalCase.mutate(findingId, {
      onSuccess: ({ case: evalCase, created }) => {
        toast.success(t(created ? "finding.turnIntoEvalCaseCreated" : "finding.turnIntoEvalCaseExists"));
        router.push(`/evals/cases/${evalCase.id}`);
      },
      onError: (err) => {
        toast.error(err instanceof ApiError && err.message ? err.message : t("finding.turnIntoEvalCaseNoDiff"));
      },
    });
  };

  const handleAction = (findingId: string, act: FindingCardAction) => {
    if (act === "seed_eval_case") {
      handleSeedEvalCase(findingId);
      return;
    }
    action.mutate({ findingId, action: act, prId });
  };

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              targetFindingId={effectiveTargetId}
              targetNonce={effectiveTargetNonce}
              onAction={(act) => handleAction(f.id, act)}
            />
          ))
        )}
      </div>
    </div>
  );
}
