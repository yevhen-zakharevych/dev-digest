/* EvalsTab (T12, AC-30) — an agent's eval metric cards, trend, case list,
   and run-all/create/run/edit/delete controls.

   Three rules make this screen honest, not just decorative (see the task's
   own card):
     1. Zero cases -> an explicit empty state AND "-" for every metric,
        never a 0% (AC-31) — an absent measurement and a measured zero are
        rendered by two different code paths below, never the same one.
     2. Cases but never run -> "never run", "-", empty trend, Run enabled
        (AC-32).
     3. The authoritative "N / M passing" comes from the latest eval RUN
        (never a draft), names that run, and does not move when a draft
        lands (AC-46/AC-50) — the denominator is that run's own case count,
        which is allowed to be smaller than the agent's current case count.

   Data comes ONLY from `@/lib/hooks/evals` (T9) — no `api` call here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  EmptyState,
  formatCost,
  Icon,
  LineChart,
  MetricCard,
  Modal,
  ProgressBar,
  Skeleton,
  type ChartSeries,
} from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import {
  useAgentEvalDashboard,
  useCancelEvalRun,
  useDeleteEvalCase,
  useEvalCases,
  useEvalRun,
  useStartEvalRun,
} from "@/lib/hooks/evals";
import { EvalCaseModal } from "@/features/evals/components/EvalCaseModal";
import { EvalCompareModal } from "@/features/evals/components/EvalCompareModal";
import { CaseRow } from "./CaseRow";
import { formatDateTime, formatPercent, inFlightRun, latestDoneRun, statusForCase } from "./helpers";
import { s } from "./styles";

/* No i18n key exists for these three metric-card titles (checked every
   `messages/en/*.json` — `eval.json`'s `evalsTab.metricsSubtitle` only has
   the combined "Recall / Precision / Citation" sentence, no per-card short
   label). Per this task's card ("if one is genuinely missing, report it, do
   not add it") these stay hardcoded English rather than touching eval.json;
   reported in the task's final response. */
const METRIC_LABELS = { recall: "Recall", precision: "Precision", citation: "Citation accuracy" } as const;

/** Max-width cap for the trend chart — high enough that the panel's own width wins. */
const TREND_MAX_WIDTH = 2000;

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const qc = useQueryClient();

  const { data: dashboard, isLoading: dashboardLoading } = useAgentEvalDashboard(agent.id);
  const { data: cases, isLoading: casesLoading } = useEvalCases(agent.id);
  const deleteCase = useDeleteEvalCase();
  const startRun = useStartEvalRun();
  const cancelRun = useCancelEvalRun();
  const [confirmRunAll, setConfirmRunAll] = React.useState(false);
  /** Newest-first pick order; the compare modal gets the OLDER run as `a` (base). */
  const [selectedRuns, setSelectedRuns] = React.useState<string[]>([]);
  const [compareRuns, setCompareRuns] = React.useState<{ a: string; b: string } | null>(null);
  /** New case (`{}`) or edit an existing one (`{ caseId }`) — both in a modal. */
  const [caseModal, setCaseModal] = React.useState<{ caseId?: string } | null>(null);

  const runs = dashboard?.recent_runs ?? [];
  const running = inFlightRun(runs);
  const doneRun = latestDoneRun(runs);
  // While a run is in flight, anchor the case list to IT (rows fill in live
  // as cases land); once settled, this is simply the latest done run.
  const anchorRun = running ?? doneRun;
  const { data: runDetail } = useEvalRun(anchorRun?.id ?? null);

  // The dashboard/case-list queries don't self-refresh when a run they are
  // NOT directly polling completes — nudge them once `runDetail` settles.
  const prevStatusRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const wasRunning = prevStatusRef.current === "running";
    const nowSettled = runDetail && runDetail.status !== "running";
    if (wasRunning && nowSettled) {
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", agent.id] });
      qc.invalidateQueries({ queryKey: ["eval-cases", agent.id] });
    }
    prevStatusRef.current = runDetail?.status ?? null;
  }, [runDetail, qc, agent.id]);

  const casesTotal = dashboard?.cases_total ?? 0;
  const isEmpty = !dashboardLoading && casesTotal === 0;
  const neverRun = !dashboardLoading && casesTotal > 0 && runs.length === 0;

  // A point is plotted ONLY when all three metrics were actually measured. The
  // chart takes `number[]`, so a null would have to be coerced — and coercing it
  // to 0 would draw an absent measurement as a hard zero, which is the exact lie
  // AC-31 forbids on the cards. A run we could not measure has nothing to plot.
  const trendPoints = (dashboard?.trend ?? []).filter(
    (p) => p.recall != null && p.precision != null && p.citation_accuracy != null,
  );
  const trendSeries: ChartSeries[] = [
    { name: METRIC_LABELS.recall, color: "var(--ok)", data: trendPoints.map((p) => p.recall!) },
    { name: METRIC_LABELS.precision, color: "var(--accent)", data: trendPoints.map((p) => p.precision!) },
    { name: METRIC_LABELS.citation, color: "var(--warn)", data: trendPoints.map((p) => p.citation_accuracy!) },
  ];
  const driftedPoints = trendPoints.filter((p) => p.set_drifted);

  const handleRunAll = () => {
    setConfirmRunAll(false);
    startRun.mutate(agent.id);
  };

  const handleEdit = (caseId: string) => setCaseModal({ caseId });
  const handleNewCase = () => setCaseModal({});
  const handleDelete = (caseId: string) => deleteCase.mutate(caseId);

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div style={s.flexGrow}>
          <div style={s.title}>{t("evalsTab.metricsTitle")}</div>
          <div style={s.subtitle}>{t("evalsTab.metricsSubtitle")}</div>
        </div>
        <Button kind="ghost" size="sm" icon="ExternalLink" onClick={() => router.push("/evals")}>
          {t("evalsTab.viewDashboard")}
        </Button>
      </div>

      {running && runDetail && (
        <div style={s.progressWrap} role="status">
          <Icon.RefreshCw size={15} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {t("dashboard.progress", { done: runDetail.results.length, total: runDetail.cases_total })}
            </div>
            <ProgressBar
              value={runDetail.cases_total > 0 ? (runDetail.results.length / runDetail.cases_total) * 100 : 0}
            />
          </div>
          <Button
            kind="secondary"
            size="sm"
            icon="X"
            loading={cancelRun.isPending}
            onClick={() => cancelRun.mutate(running.id)}
          >
            {cancelRun.isPending ? t("dashboard.cancelling") : t("dashboard.cancelRun")}
          </Button>
        </div>
      )}

      <div style={s.metricRow} data-testid="eval-metric-cards">
        <MetricCard label={METRIC_LABELS.recall} value={formatPercent(dashboard?.current.recall)} />
        <MetricCard label={METRIC_LABELS.precision} value={formatPercent(dashboard?.current.precision)} />
        <MetricCard label={METRIC_LABELS.citation} value={formatPercent(dashboard?.current.citation_accuracy)} />
      </div>

      <div style={s.helpLine}>
        <Icon.Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{t("help.mechanicalScoring")}</span>
      </div>
      <div style={s.helpLine}>
        <Icon.Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{t("help.citationAccuracy")}</span>
      </div>

      <div style={s.section}>
        <div style={s.sectionHead}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("dashboard.metricTrend")}</div>
        </div>
        <div style={s.trendWrap}>
          {trendPoints.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {neverRun ? t("states.neverRunHint") : t("states.noMetrics")}
            </div>
          ) : (
            <>
              {/* `w` is a MAX-width cap, not a fixed width (the chart is already
                  `width: 100%`); its 620px default leaves two thirds of this
                  full-width panel empty. And `yMin` defaults to 0.6 — but a
                  deliberately corrupted prompt is SUPPOSED to push precision far
                  below that, and the line would then be drawn outside the plot
                  area. These are 0..1 ratios; the honest axis is 0..1. */}
              <LineChart series={trendSeries} h={160} w={TREND_MAX_WIDTH} yMin={0} yMax={1} />
              {driftedPoints.length > 0 && (
                <div style={s.driftedList}>
                  {driftedPoints.map((p) => (
                    <div key={p.run_id} style={s.driftedRow}>
                      <Icon.AlertTriangle size={12} style={{ color: "var(--warn)" }} />
                      <span>
                        {formatDateTime(p.ran_at)} — {t("dashboard.trendDriftedPoint")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Run history + the ONLY entry point into the comparison (AC-24). A
          compare view nobody can reach is a compare view that does not exist:
          selecting two runs here is what makes "old prompt vs new" a thing a
          user can actually do. Drafts never appear (AC-47). */}
      <div style={s.section}>
        <div style={s.sectionHead}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("dashboard.recentRuns")}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", flex: 1, marginLeft: 10 }}>
            {t("compare.selectTwo")}
          </div>
          <Button
            kind="secondary"
            disabled={selectedRuns.length !== 2}
            onClick={() => setCompareRuns({ a: selectedRuns[1]!, b: selectedRuns[0]! })}
          >
            {t("compare.compare")}
          </Button>
        </div>

        {runs.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noRuns")}</div>
        ) : (
          <div style={s.runsTable}>
            <div style={s.runsHeadRow}>
              <span />
              <span>{t("dashboard.table.ranAt")}</span>
              <span>{t("metrics.recall")}</span>
              <span>{t("metrics.precision")}</span>
              <span>{t("metrics.citation")}</span>
              <span>{t("dashboard.table.pass")}</span>
              <span>{t("dashboard.table.cost")}</span>
            </div>
            {runs.map((r) => {
              const checked = selectedRuns.includes(r.id);
              return (
                <div key={r.id} style={s.runsRow} data-testid={`run-row-${r.id}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-label={`${t("compare.selectTwo")} — ${formatDateTime(r.started_at)}`}
                    // Cap the selection at two: picking a third drops the oldest
                    // pick, so the Compare button never sits disabled with no way
                    // for the user to see why.
                    onChange={() =>
                      setSelectedRuns((prev) =>
                        prev.includes(r.id)
                          ? prev.filter((id) => id !== r.id)
                          : [r.id, ...prev].slice(0, 2),
                      )
                    }
                  />
                  <span>
                    {formatDateTime(r.started_at)}
                    {r.agent_version != null && (
                      <Badge mono color="var(--text-secondary)" style={{ marginLeft: 6 }}>
                        v{r.agent_version}
                      </Badge>
                    )}
                    {r.set_drifted && (
                      <Icon.AlertTriangle
                        size={12}
                        style={{ color: "var(--warn)", marginLeft: 6 }}
                        aria-label={t("dashboard.trendDriftedPoint")}
                      />
                    )}
                  </span>
                  <span className="tnum">{formatPercent(r.recall)}</span>
                  <span className="tnum">{formatPercent(r.precision)}</span>
                  <span className="tnum">{formatPercent(r.citation_accuracy)}</span>
                  <span className="tnum">
                    {r.traces_passed} / {r.traces_total}
                  </span>
                  <span className="tnum">{formatCost(r.cost_usd)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={s.section}>
        <div style={s.sectionHead}>
          <div style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{t("evalsTab.casesHeading")}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)" }} title={t("dashboard.spend.draftsHint")}>
            {t("dashboard.spend.label")}:{" "}
            {t("dashboard.spend.breakdown", {
              total: formatCost(dashboard?.spend.total_usd),
              runs: formatCost(dashboard?.spend.run_usd),
              drafts: formatCost(dashboard?.spend.draft_usd),
            })}
          </div>
          <Button kind="secondary" size="sm" icon="Plus" disabled={!agent.enabled} onClick={handleNewCase}>
            {t("evalsTab.newCase")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={!agent.enabled || casesTotal === 0 || !!running}
            title={
              !agent.enabled
                ? t("evalsTab.agentDisabled")
                : casesTotal === 0
                  ? undefined
                  : running
                    ? t("evalsTab.runInFlight")
                    : undefined
            }
            onClick={() => setConfirmRunAll(true)}
          >
            {t("evalsTab.runAll")}
          </Button>
        </div>

        {doneRun && (
          <div style={s.headline}>
            <span style={s.headlineCount}>
              {t("evalsTab.passingSummary", { passed: doneRun.traces_passed, total: doneRun.traces_total })}
            </span>
            <span style={s.headlineFrom}>
              {t("evalsTab.passingFrom", {
                version: doneRun.agent_version ?? "—",
                ranAt: formatDateTime(doneRun.finished_at ?? doneRun.started_at),
              })}
            </span>
            <span style={s.headlineFrom}>· {t("evalsTab.caseCount", { count: casesTotal })}</span>
          </div>
        )}

        {casesLoading || dashboardLoading ? (
          <div style={{ marginTop: 12 }}>
            <Skeleton height={56} />
            <Skeleton height={56} style={{ marginTop: 8 }} />
          </div>
        ) : isEmpty ? (
          <EmptyState icon="FlaskConical" title={t("states.noCases")} body={t("states.noCasesHint")} />
        ) : (
          <div style={s.caseList}>
            {neverRun && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("evalsTab.neverRun")}</div>}
            {(cases ?? []).map((c) => (
              <CaseRow
                key={c.id}
                evalCase={c}
                status={statusForCase(c.id, anchorRun, runDetail?.results)}
                anchorRun={anchorRun}
                agentEnabled={agent.enabled}
                batchRunInFlight={!!running}
                onEdit={() => handleEdit(c.id)}
                onDelete={() => handleDelete(c.id)}
              />
            ))}
          </div>
        )}
      </div>

      {confirmRunAll && (
        <Modal
          title={t("evalsTab.runAll")}
          onClose={() => setConfirmRunAll(false)}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button kind="secondary" onClick={() => setConfirmRunAll(false)}>
                {t("caseEditor.cancel")}
              </Button>
              <Button kind="primary" loading={startRun.isPending} onClick={handleRunAll}>
                {t("evalsTab.runAll")}
              </Button>
            </div>
          }
        >
          {/* AC-34: name the case count — the model-call count — before a
              single call is issued. */}
          <div style={{ padding: "16px 24px", fontSize: 13.5, color: "var(--text-secondary)" }}>
            {t("dashboard.runPreview", { count: casesTotal })}
          </div>
        </Modal>
      )}

      {compareRuns && (
        <EvalCompareModal
          runIdA={compareRuns.a}
          runIdB={compareRuns.b}
          agentId={agent.id}
          onClose={() => setCompareRuns(null)}
        />
      )}

      {caseModal && (
        <EvalCaseModal
          caseId={caseModal.caseId}
          agentId={agent.id}
          agentName={agent.name}
          onClose={() => setCaseModal(null)}
        />
      )}
    </div>
  );
}
