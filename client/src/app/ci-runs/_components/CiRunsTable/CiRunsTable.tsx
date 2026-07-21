"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { useCiRuns, useRefreshCiRuns, type CiRunRow as CiRunRowData } from "@/lib/hooks/ci-runs";
import { ApiError } from "@/lib/api";
import { CiRunStatusPill } from "@/features/ci/components/CiRunStatusPill";
import {
  CI_RUN_COLUMNS,
  formatCost,
  formatDuration,
  formatFindings,
  formatPrNumber,
} from "../../_lib/columns";

/** pr# · repository · agent · status · findings · cost · duration · view-link (AC-40). */
const GRID_TEMPLATE = "0.6fr 1.3fr 1fr 0.9fr 0.7fr 0.6fr 0.7fr 0.6fr";

const headRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap: 10,
  padding: "6px 14px",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap: 10,
  alignItems: "center",
  padding: "10px 14px",
  fontSize: 13,
};

/**
 * CI Runs page body: title, an explicit Refresh action (AC-32 — the ONLY
 * trigger for ingestion; the underlying query never polls), the runs table
 * (AC-38, AC-39, AC-40), and a partial-refresh-failure banner (AC-37) that
 * never blanks the existing rows.
 */
export function CiRunsTable() {
  const t = useTranslations("ci");
  const { data, isLoading, isError, error, refetch } = useCiRuns();
  const refresh = useRefreshCiRuns();
  const failedRepos = refresh.data?.failed ?? [];

  if (isLoading) {
    return (
      <div style={{ padding: "20px 28px 48px", maxWidth: 1180 }}>
        <Skeleton height={28} width={220} />
        <div style={{ height: 16 }} />
        <Skeleton height={160} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        fullScreen
        title="Couldn't load CI runs"
        body={error instanceof ApiError ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div style={{ padding: "20px 28px 48px", maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{t("runs.title")}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{t("runs.subtitle")}</div>
        </div>
        <Button kind="secondary" icon="RefreshCw" loading={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? t("runs.refreshing") : t("runs.refresh")}
        </Button>
      </div>

      {failedRepos.length > 0 && (
        <div role="status" style={{ marginBottom: 12, fontSize: 13, color: "var(--crit)" }}>
          {t("runs.refreshFailed", { repos: failedRepos.map((f) => f.repo).join(", ") })}
        </div>
      )}

      {data.length === 0 ? (
        <EmptyState icon="Workflow" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
      ) : (
        <Card pad={false}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={headRowStyle}>
              {CI_RUN_COLUMNS.map((col) => (
                <span key={col.key}>{t(col.labelKey)}</span>
              ))}
              <span>{t("runs.view")}</span>
            </div>
            {data.map((run) => (
              <CiRunRow key={run.id} run={run} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function CiRunRow({ run }: { run: CiRunRowData }) {
  const t = useTranslations("ci");
  return (
    <div data-testid={`ci-run-${run.id}`} style={rowStyle}>
      <span className="tnum">{formatPrNumber(run.pr_number)}</span>
      <span>{run.repo}</span>
      {/* `run.agent` is third-party content from someone else's CI artifact — always
          rendered as plain text (JSX interpolation), never markup (AC-35 render half). */}
      <span>{run.agent ?? "—"}</span>
      <span>
        <CiRunStatusPill status={run.status} />
      </span>
      <span className="tnum">{formatFindings(run.findings_count)}</span>
      <span className="tnum">{formatCost(run.cost_usd)}</span>
      <span className="tnum">{formatDuration(run.duration_s)}</span>
      <span>
        {run.github_url ? (
          <a href={run.github_url} target="_blank" rel="noopener noreferrer">
            {t("runs.view")}
          </a>
        ) : (
          "—"
        )}
      </span>
    </div>
  );
}
