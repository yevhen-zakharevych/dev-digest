/* Multi-Agent Review — Configure run — /repos/:repoId/multi-agent.
   Step 1: pick a PR. Step 2 (only once a PR is picked): checkbox-select
   agents with a description + time/cost hint each, Select-all, and a Run
   button with an adjacent summary estimate (AC-4, AC-5, AC-6). Running
   navigates to the results page for that PR (AC-6, same route as AC-3). */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell/AppShell";
import { RepoNotFound } from "@/components/RepoNotFound";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { usePulls } from "@/lib/hooks/core";
import { useLatestMultiRun } from "@/lib/hooks/multi-agent-runs";
import { PrPicker } from "./_components/PrPicker/PrPicker";
import { AgentSelection } from "./_components/AgentSelection/AgentSelection";

export default function ConfigureMultiAgentRunPage() {
  const t = useTranslations("multiAgent");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: pulls } = usePulls(repoId);

  const [prNumber, setPrNumber] = React.useState<number | null>(null);
  const selectedPr = (pulls ?? []).find((p) => p.number === prNumber) ?? null;
  const selectedPrId = selectedPr?.id ?? null;

  // A picked PR that already has a multi-run gets a direct link to its results.
  // Without it this page can only ever CREATE a run: the results route is not
  // linked from anywhere else, so an existing run is unreachable once you
  // navigate away from it.
  const { data: latestMultiRun } = useLatestMultiRun(selectedPrId);

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("configure.crumb") },
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div
        style={{
          padding: "28px 32px 44px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          maxWidth: 760,
          margin: "0 auto",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)" }}>
            {t("configure.title")}
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>{t("configure.subtitle")}</p>
        </div>

        <PrPicker pulls={pulls ?? []} value={prNumber} onChange={setPrNumber} />

        {selectedPr && latestMultiRun ? (
          <div
            data-testid="existing-run-link"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 14px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg-elevated)",
            }}
          >
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {t("configure.existingRun", { count: latestMultiRun.agent_count })}
            </span>
            <Button
              kind="secondary"
              size="sm"
              icon="Users"
              onClick={() => router.push(`/repos/${repoId}/multi-agent/${selectedPr.number}`)}
            >
              {t("configure.viewResults")}
            </Button>
          </div>
        ) : null}

        {selectedPr && selectedPrId ? (
          <AgentSelection
            repoId={repoId}
            prId={selectedPrId}
            prNumber={selectedPr.number}
            onRan={(number) => router.push(`/repos/${repoId}/multi-agent/${number}`)}
          />
        ) : (
          <EmptyState icon="GitPullRequest" title={t("configure.pickPrFirst")} />
        )}
      </div>
    </AppShell>
  );
}
