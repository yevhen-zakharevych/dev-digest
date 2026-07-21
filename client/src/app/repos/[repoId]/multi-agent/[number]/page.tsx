/* Multi-Agent Review results — /repos/:repoId/multi-agent/:number.

   Keyed by PR NUMBER (like the PR detail route) but every PR API is keyed by
   the row's uuid, so `number → prId` is resolved through the cached pulls list
   exactly as `pulls/[number]/page.tsx` does.

   v1 renders a single display mode (Columns) — there is deliberately no
   Columns↔Tabs toggle, and the scaffolded-but-unused `runs.page.view.*` keys
   are left in place. */
"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton, formatCost } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell/AppShell";
import { RepoNotFound } from "@/components/RepoNotFound";
import { usePulls } from "@/lib/hooks/core";
import { useLatestMultiRun } from "@/lib/hooks/multi-agent-runs";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { AgentColumns } from "./_components/AgentColumns/AgentColumns";
import { DisagreementBlock } from "./_components/DisagreementBlock/DisagreementBlock";
import { FindingDetailPanel } from "./_components/FindingDetailPanel/FindingDetailPanel";
import { totalSeconds } from "./_lib/format";
import { s } from "./_lib/styles";

export default function MultiAgentResultsPage() {
  const { repoId, number } = useParams<{ repoId: string; number: string }>();
  const t = useTranslations("runs");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const pr = pulls?.find((p) => p.number === Number(number)) ?? null;
  const prId = pr?.id ?? null;

  const {
    data: run,
    isLoading: runLoading,
    isError,
    refetch,
  } = useLatestMultiRun(prId);

  const [selectedFindingId, setSelectedFindingId] = React.useState<string | null>(null);
  const configureHref = `/repos/${repoId}/multi-agent`;

  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("page.crumb"), href: configureHref },
    { label: `#${number}`, mono: true },
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (pullsLoading || (prId != null && runLoading)) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={220} />
        </div>
      </AppShell>
    );
  }

  if (!pr || !prId) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("page.loadError")}
          body={t("page.prNotFound", { number })}
        />
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen title={t("page.loadError")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <header style={s.header}>
          <div style={s.headerMain}>
            <h1 style={s.title}>{t("page.title")}</h1>
            <div style={s.prTitle}>{pr.title}</div>
            {run && (
              <>
                <div style={s.subtitle} data-testid="selected-agents">
                  {t("page.selectedAgents", { count: run.agent_count })}
                </div>
                <div style={s.meta} data-testid="run-meta">
                  {t("page.meta", {
                    count: run.agent_count,
                    duration: totalSeconds(run.total_duration_ms),
                    cost: formatCost(run.total_cost_usd),
                  })}
                </div>
              </>
            )}
          </div>
          {/* A navigation control, so it is an anchor styled as a button — NOT
              a <Button> nested inside <Link> (a <button> inside an <a> is
              invalid, non-focusable-once HTML). */}
          <Link href={configureHref} style={s.configureLink} data-testid="configure-run">
            <Icon.Settings size={14} />
            {t("page.configureRun")}
          </Link>
        </header>

        {/* AC-14 null case: a PR that has never had a multi-run gets the
            first-run empty state — not a 404, and not a blank area. */}
        {!run ? (
          <div data-testid="no-run-empty">
            <EmptyState
              icon="Layers"
              title={t("page.noRun.title")}
              body={t("page.noRun.bodyConfigure")}
            />
          </div>
        ) : (
          <>
            <AgentColumns
              columns={run.columns}
              repoId={repoId}
              prNumber={number}
              selectedFindingId={selectedFindingId}
              onSelectFinding={setSelectedFindingId}
            />

            {selectedFindingId && (
              <FindingDetailPanel
                prId={prId}
                findingId={selectedFindingId}
                repoFullName={activeRepo?.full_name ?? null}
                headSha={pr.head_sha}
                onClose={() => setSelectedFindingId(null)}
              />
            )}

            <DisagreementBlock conflicts={run.conflicts} columns={run.columns} />
          </>
        )}
      </div>
    </AppShell>
  );
}
