"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { useEvalComparison, useEvalRunHistory, usePromoteEvalRun } from "../../../../../lib/hooks/evals";
import { ApiError } from "../../../../../lib/api";
import { formatCost } from "../../../_lib/format";
import { MetricDeltaRow } from "./_components/MetricDeltaRow";
import { PromptDiff } from "./_components/PromptDiff";
import { SkillDeltaList } from "./_components/SkillDeltaList";
import { PromoteModal, type RegressionLine } from "./_components/PromoteModal";
import { RunPicker } from "./_components/RunPicker";
import { regressions, runLabel } from "./helpers";
import { s } from "./styles";

const METRIC_LABELS: Record<"recall" | "precision" | "citation_accuracy", string> = {
  recall: "Recall",
  precision: "Precision",
  citation_accuracy: "Citation",
};

/**
 * Compare exactly two runs of one agent (AC-24..28, AC-38, AC-51, AC-52).
 */
export function EvalCompare({
  runIdA,
  runIdB,
  agentId,
  onPick,
}: {
  runIdA: string | null;
  runIdB: string | null;
  agentId: string | null;
  onPick: (a: string, b: string) => void;
}) {
  const t = useTranslations("eval");
  const { data: history } = useEvalRunHistory(agentId);
  const { data, isLoading, isError, error, refetch } = useEvalComparison(runIdA, runIdB);
  const promote = usePromoteEvalRun();
  const [promoteTarget, setPromoteTarget] = React.useState<null | { runId: string; label: string; regs: RegressionLine[] }>(
    null,
  );
  const [promoteError, setPromoteError] = React.useState<string | null>(null);

  if (!runIdA || !runIdB) {
    return <RunPicker runs={history} onCompare={onPick} />;
  }

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={24} width={260} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        fullScreen
        title="Couldn't load this comparison"
        body={error instanceof ApiError ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  const doPromote = (target: "base" | "candidate") => {
    const promoted = target === "base" ? data.base : data.candidate;
    const other = target === "base" ? data.candidate : data.base;
    const regs = regressions(other, promoted);
    setPromoteError(null);
    if (regs.length > 0) {
      setPromoteTarget({
        runId: promoted.id,
        label: runLabel(promoted),
        regs: regs.map((m) => ({
          label: METRIC_LABELS[m],
          from: `${Math.round((other[m] ?? 0) * 100)}%`,
          to: `${Math.round((promoted[m] ?? 0) * 100)}%`,
        })),
      });
    } else {
      promote.mutate(
        { runId: promoted.id },
        { onError: (e) => setPromoteError(e instanceof ApiError ? e.message : "Promote failed.") },
      );
    }
  };

  const confirmPromote = () => {
    if (!promoteTarget) return;
    promote.mutate(
      { runId: promoteTarget.runId, acknowledgeRegression: true },
      {
        onSuccess: () => setPromoteTarget(null),
        onError: (e) => setPromoteError(e instanceof ApiError ? e.message : "Promote failed."),
      },
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div style={s.title}>{t("compare.title", { a: runLabel(data.base), b: runLabel(data.candidate) })}</div>
        <div style={s.subtitle}>{t("compare.subtitle")}</div>
      </div>

      {!data.comparable ? (
        <EmptyState icon="GitPullRequest" title={t("compare.notComparable")} body={t("compare.notComparableHint")} />
      ) : (
        <>
          {data.effective_config_divergence && (
            <div style={{ ...s.banner, ...s.divergenceBanner }}>{t("compare.sameVersionDifferentConfig")}</div>
          )}
          {!data.effective_config_divergence && data.base.agent_version === data.candidate.agent_version && (
            <div style={s.banner}>{t("compare.noiseFloor")}</div>
          )}

          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
            {t("compare.sharedCases", { shared: data.shared_case_count, total: data.base.cases_total })}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>{t("help.deltaNeedsContext")}</div>

          <div style={s.metricsGrid}>
            <MetricDeltaRow label="Recall" base={data.base.recall} candidate={data.candidate.recall} />
            <MetricDeltaRow label="Precision" base={data.base.precision} candidate={data.candidate.precision} />
            <MetricDeltaRow label="Citation" base={data.base.citation_accuracy} candidate={data.candidate.citation_accuracy} />
            <MetricDeltaRow label={t("compare.cost")} base={data.base.cost_usd} candidate={data.candidate.cost_usd} format={formatCost} />
          </div>

          {data.excluded_cases.length > 0 && (
            <>
              <div style={s.sectionHeading}>{t("compare.excluded", { count: data.excluded_cases.length })}</div>
              <div style={s.caseList} data-testid="excluded-cases">
                {data.excluded_cases.map((c) => (
                  <div key={c.case_id}>
                    {c.case_name} —{" "}
                    {c.reason === "changed"
                      ? t("compare.excludedChanged")
                      : c.reason === "added"
                        ? t("compare.excludedAdded")
                        : t("compare.excludedRemoved")}
                  </div>
                ))}
              </div>
            </>
          )}

          {data.flipped_cases.length > 0 && (
            <>
              <div style={s.sectionHeading}>{t("compare.flipped", { count: data.flipped_cases.length })}</div>
              <div style={s.caseList} data-testid="flipped-cases">
                {data.flipped_cases.map((c) => (
                  <div key={c.case_id}>
                    {c.case_name} —{" "}
                    {c.direction === "now_passing" ? t("compare.flippedToPass") : t("compare.flippedToFail")}
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={s.sectionHeading}>{t("compare.promptDiff")}</div>
          <PromptDiff
            basePrompt={data.base_config?.system_prompt ?? null}
            candidatePrompt={data.candidate_config?.system_prompt ?? null}
            unavailable={data.config_unavailable}
          />

          <div style={s.sectionHeading}>{t("compare.skillDelta")}</div>
          <SkillDeltaList deltas={data.skill_delta} unavailable={data.config_unavailable} />

          {promoteError && <div style={{ ...s.banner, color: "var(--crit)" }}>{promoteError}</div>}

          <div style={s.actionsRow}>
            <Button
              kind="secondary"
              disabled={!data.base_config || promote.isPending}
              onClick={() => doPromote("base")}
            >
              {t("compare.promote", { version: runLabel(data.base) })}
            </Button>
            <Button
              kind="primary"
              disabled={!data.candidate_config || promote.isPending}
              onClick={() => doPromote("candidate")}
            >
              {t("compare.promote", { version: runLabel(data.candidate) })}
            </Button>
          </div>
          {(!data.base_config || !data.candidate_config) && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{t("compare.promoteUnavailable")}</div>
          )}
        </>
      )}

      {promoteTarget && (
        <PromoteModal
          version={promoteTarget.label}
          regressions={promoteTarget.regs}
          isPending={promote.isPending}
          onConfirm={confirmPromote}
          onClose={() => setPromoteTarget(null)}
        />
      )}
    </div>
  );
}
