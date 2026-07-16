/* CaseRow — one eval case in the Evals tab's case list (AC-30).
   Owns its own draft (single-case scratch run, AC-47) trigger + poll so the
   row can update live without the parent re-fetching the whole case list;
   the parent still owns the case's status against the agent's latest BATCH
   run (passed in as `status`/`anchorRun` — see `helpers.ts`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, CategoryTag, Icon, SeverityBadge, type Category, type UISeverity } from "@devdigest/ui";
import type { EvalCase, EvalDraftResult, EvalRunSummary } from "@devdigest/shared";
import { useEvalCaseDraft, useRunEvalDraft } from "@/lib/hooks/evals";
import { caseExpectedGot, draftIsNewer, formatDateTime, type CaseRowStatus } from "./helpers";
import { s } from "./styles";

export function CaseRow({
  evalCase: c,
  status,
  anchorRun,
  agentEnabled,
  batchRunInFlight,
  onEdit,
  onDelete,
}: {
  evalCase: EvalCase;
  status: CaseRowStatus;
  /** The run `status` was computed against — null when the agent has never
   *  been run. Needed here only to decide whether a draft is newer (AC-50). */
  anchorRun: EvalRunSummary | null;
  agentEnabled: boolean;
  /** A batch run is in flight for this agent — a draft is refused while one
   *  runs (AC-13). */
  batchRunInFlight: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const [polling, setPolling] = React.useState(false);
  const draftQuery = useEvalCaseDraft(c.id, { pollWhileRunning: polling });
  const runDraft = useRunEvalDraft();

  const draft = draftQuery.data ?? c.latest_draft;

  React.useEffect(() => {
    if (polling && draftQuery.data && draftQuery.data.status !== "running") setPolling(false);
  }, [polling, draftQuery.data]);

  const draftRunning = draft?.status === "running";
  const draftIsHeadline = !!draft && !draftRunning && draftIsNewer(draft.ran_at, anchorRun);

  const handleRun = () => {
    setPolling(true);
    runDraft.mutate(c.id);
  };

  const handleDelete = () => {
    if (window.confirm(t("evalsTab.deleteConfirm"))) onDelete();
  };

  const runDisabledReason = !agentEnabled
    ? t("evalsTab.agentDisabled")
    : draftRunning
      ? t("caseEditor.draftInFlight")
      : batchRunInFlight
        ? t("caseEditor.draftBlockedByRun")
        : undefined;

  const sourceFinding = c.source_finding;

  return (
    <div style={s.row}>
      <div style={s.rowMain}>
        <div style={s.rowTitleLine}>
          <span style={s.rowName}>{c.name}</span>
          <Badge color={c.expectation === "must_find" ? "var(--accent)" : "var(--warn)"} mono>
            {c.expectation === "must_find" ? t("badges.mustFind") : t("badges.mustNotFlag")}
          </Badge>
          {sourceFinding && (
            <span title={t("help.provenanceChip")}>
              <SeverityBadge severity={sourceFinding.severity as UISeverity} compact />
            </span>
          )}
          {sourceFinding && (
            <span title={t("help.provenanceChip")}>
              <CategoryTag category={sourceFinding.category as Category} />
            </span>
          )}
        </div>
        <RowStatusLine
          t={t}
          status={status}
          draft={draftIsHeadline ? draft : null}
          evalCase={c}
        />
      </div>

      <div style={s.rowActions}>
        {draftRunning && (
          <span style={s.statusText("var(--accent)")} title={formatDateTime(draft?.ran_at)}>
            <Icon.RefreshCw size={12} style={{ animation: "ddspin 1s linear infinite" }} />
            {t("caseEditor.running")}
          </span>
        )}
        <Button
          kind="secondary"
          size="sm"
          icon="Play"
          disabled={!!runDisabledReason}
          title={runDisabledReason}
          loading={runDraft.isPending}
          onClick={handleRun}
        >
          {t("evalsTab.run")}
        </Button>
        <Button kind="ghost" size="sm" icon="Edit" onClick={onEdit}>
          {t("evalsTab.edit")}
        </Button>
        <button
          type="button"
          style={s.iconBtn}
          title={t("evalsTab.delete")}
          aria-label={t("evalsTab.delete")}
          disabled={!agentEnabled}
          onClick={handleDelete}
        >
          <Icon.Trash size={14} />
        </button>
      </div>
    </div>
  );
}

/** The status/expected-got line — split out so the branching (draft vs run
 *  result vs never-run vs not-yet-measured) reads as one decision table. */
function RowStatusLine({
  t,
  status,
  draft,
  evalCase,
}: {
  t: ReturnType<typeof useTranslations>;
  status: CaseRowStatus;
  draft: EvalDraftResult | null | undefined;
  evalCase: EvalCase;
}) {
  if (draft) {
    const passed = draft.outcome === "passed";
    const color = draft.outcome === "errored" ? "var(--text-muted)" : passed ? "var(--ok)" : "var(--crit)";
    const label =
      draft.outcome === "errored" ? t("states.errored") : passed ? t("evalsTab.passed") : t("evalsTab.failed");
    return (
      <div style={s.rowMeta}>
        <span style={s.statusText(color)}>
          {passed ? <Icon.CheckCircle size={13} /> : <Icon.XCircle size={13} />}
          {label}
        </span>
        <Badge color="var(--accent)" bg="var(--accent-bg)">
          {t("states.draft")}
        </Badge>
        {draft.stale && (
          <span title={t("states.staleHint")}>
            <Badge color="var(--warn)" bg="var(--warn-bg)">
              {t("states.stale")}
            </Badge>
          </span>
        )}
        <span>{t("evalsTab.expectedGot", { expected: draft.expected_count, got: draft.actual_count })}</span>
      </div>
    );
  }

  if (status.kind === "result") {
    const r = status.result;
    const { expected, got } = caseExpectedGot(evalCase, r);
    const color = r.outcome === "errored" ? "var(--text-muted)" : r.outcome === "passed" ? "var(--ok)" : "var(--crit)";
    const label =
      r.outcome === "errored" ? t("states.errored") : r.outcome === "passed" ? t("evalsTab.passed") : t("evalsTab.failed");
    return (
      <div style={s.rowMeta}>
        <span style={s.statusText(color)} title={r.outcome === "errored" ? t("states.erroredHint") : undefined}>
          {r.outcome === "errored" ? (
            <Icon.AlertTriangle size={13} />
          ) : r.outcome === "passed" ? (
            <Icon.CheckCircle size={13} />
          ) : (
            <Icon.XCircle size={13} />
          )}
          {label}
        </span>
        <span>{t("evalsTab.expectedGot", { expected, got })}</span>
      </div>
    );
  }

  if (status.kind === "pending") {
    return (
      <div style={s.rowMeta}>
        <span style={s.statusText("var(--text-muted)")}>
          <Icon.Clock size={13} />
          {t("dashboard.running")}
        </span>
      </div>
    );
  }

  if (status.kind === "not_measured") {
    return (
      <div style={s.rowMeta}>
        <span style={s.statusText("var(--text-muted)")} title={t("states.notMeasuredHint")}>
          <Icon.Clock size={13} />
          {t("states.notMeasured")}
        </span>
      </div>
    );
  }

  return (
    <div style={s.rowMeta}>
      <span style={s.statusText("var(--text-muted)")}>
        <Icon.Clock size={13} />
        {t("states.neverRun")}
      </span>
    </div>
  );
}
