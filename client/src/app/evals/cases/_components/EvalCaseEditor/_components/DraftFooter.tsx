"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { EvalDraftResult } from "@devdigest/shared";
import { formatCost, formatDurationSeconds } from "../../../../_lib/format";
import { s } from "../styles";

const OUTCOME_KEY: Record<NonNullable<EvalDraftResult["outcome"]>, string> = {
  passed: "caseEditor.lastRunPassed",
  failed: "caseEditor.lastRunFailed",
  errored: "caseEditor.lastRunErrored",
};

/**
 * The case's latest draft (AC-47/48): "Run case" fires a single-case
 * scratch result — never a run, never in the run history/trend, never
 * comparable. It is persisted ON THE CASE and survives a reload; a since-
 * changed agent config marks it `stale` rather than presenting it as current.
 */
export function DraftFooter({
  draft,
  onRun,
  runPending,
  runError,
}: {
  draft: EvalDraftResult | null | undefined;
  onRun: () => void;
  runPending: boolean;
  runError: string | null;
}) {
  const t = useTranslations("eval");
  const isRunning = draft?.status === "running";
  const runDisabled = runPending || isRunning;

  return (
    <div>
      <div style={s.footer}>
        <Button kind="secondary" icon="Play" onClick={onRun} disabled={runDisabled} loading={runPending}>
          {isRunning ? t("caseEditor.running") : t("caseEditor.runCase")}
        </Button>
        {isRunning && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("caseEditor.draftInFlight")}</span>}
      </div>

      {runError && <div style={s.fieldError}>{runError}</div>}

      {draft && draft.status !== "running" && draft.outcome && (
        <div style={s.draftSummary} data-testid="draft-summary">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>{t(OUTCOME_KEY[draft.outcome])}</span>
            <Badge color="var(--accent)">{t("states.draft")}</Badge>
            {draft.stale && <Badge color="var(--text-muted)">{t("states.stale")}</Badge>}
          </div>
          <div style={{ color: "var(--text-muted)" }}>
            {t("caseEditor.resultSummary", {
              expected: draft.expected_count,
              got: draft.actual_count,
              duration: formatDurationSeconds(draft.duration_ms).replace("s", ""),
              cost: formatCost(draft.cost_usd),
            })}
          </div>
          {draft.stale && <div style={{ color: "var(--text-muted)" }}>{t("states.staleHint")}</div>}
        </div>
      )}
    </div>
  );
}
