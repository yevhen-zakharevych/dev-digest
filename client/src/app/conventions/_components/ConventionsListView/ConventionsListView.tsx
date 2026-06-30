/* ConventionsListView (/conventions) — repo-scoped extractor workflow.

   Orchestrates: Re-scan → live status via SSE → list of candidates →
   accept/reject + inline rule editing → Create-skill modal. Repo selection
   piggybacks on the shell's `useActiveRepo` so the page follows whatever
   the user picks from the sidebar dropdown. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
} from "@devdigest/ui";
import type { ConventionCandidate, Skill } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell/AppShell";
import { useActiveRepo } from "../../../../lib/repo-context";
import { useRunEvents } from "../../../../lib/hooks/reviews";
import {
  useConventions,
  useCreateSkillFromConventions,
  useExtractConventions,
  useLatestConventionScan,
  useUpdateConvention,
} from "../../../../lib/hooks/conventions";
import { notify } from "../../../../lib/toast";
import { ConventionCard } from "../ConventionCard/ConventionCard";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal/CreateSkillFromConventionsModal";
import { s } from "./styles";

export function ConventionsListView() {
  const t = useTranslations("conventions");
  const { activeRepo, reposLoaded } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const conventions = useConventions(repoId);
  const latestScan = useLatestConventionScan(repoId);
  const extract = useExtractConventions();
  const updateOne = useUpdateConvention();
  const createSkillMut = useCreateSkillFromConventions();

  // Track the active scan locally so SSE can follow it even if a refetch
  // briefly drops it from server state.
  const [activeScanId, setActiveScanId] = React.useState<string | null>(null);
  const { events, running } = useRunEvents(activeScanId ? [activeScanId] : []);

  // Recover SSE stream after page reload when a scan is already in progress.
  React.useEffect(() => {
    const scan = latestScan.data;
    if (scan?.status === "running" && scan.scan_id && !activeScanId) {
      setActiveScanId(scan.scan_id);
    }
  }, [latestScan.data, activeScanId]);

  // When SSE flips from running → finished, the scan is done. Invalidations
  // happen in the mutation hooks; here we just flush the local scanId.
  React.useEffect(() => {
    if (!activeScanId) return;
    if (!running && events.length > 0) {
      setActiveScanId(null);
      void conventions.refetch();
      void latestScan.refetch();
    }
  }, [running, events.length, activeScanId, conventions, latestScan]);

  const candidates = (conventions.data ?? []).filter((c) => c.status !== "rejected");
  const acceptedIds = candidates
    .filter((c) => c.status === "accepted")
    .map((c) => c.id);

  // User-controlled selection drives which accepted candidates land in the
  // Create-skill modal. Default: all accepted are selected.
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    setSelectedIds(new Set(acceptedIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedIds.join(",")]);

  const selectedCandidates: ConventionCandidate[] = candidates.filter(
    (c) => c.status === "accepted" && selectedIds.has(c.id),
  );

  const [skillModalOpen, setSkillModalOpen] = React.useState(false);

  const runScan = async () => {
    if (!repoId) return;
    try {
      const { scanId } = await extract.mutateAsync(repoId);
      setActiveScanId(scanId);
    } catch (err) {
      notify.error((err as Error).message || t("page.extractionFailed"));
    }
  };

  const onAccept = (id: string) =>
    updateOne.mutate({ id, repoId: repoId!, patch: { status: "accepted" } });
  const onReject = (id: string) =>
    updateOne.mutate({ id, repoId: repoId!, patch: { status: "rejected" } });
  const onSaveRule = async (id: string, rule: string) => {
    await updateOne.mutateAsync({ id, repoId: repoId!, patch: { rule } });
  };

  const onCreated = (_skill: Skill) => {
    notify.success(t("page.skillCreated"));
  };

  const isScanning = running || extract.isPending || latestScan.data?.status === "running";

  // ---- No repo selected -----------------------------------------------------
  if (reposLoaded && !repoId) {
    return (
      <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
        <div style={s.page}>
          <EmptyState
            icon="Code"
            title={t("page.noRepoTitle")}
            body={t("page.noRepoBody")}
          />
        </div>
      </AppShell>
    );
  }

  // ---- Main layout ----------------------------------------------------------
  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
      {skillModalOpen && repoId && selectedCandidates.length > 0 && (
        <CreateSkillFromConventionsModal
          repoId={repoId}
          candidates={selectedCandidates}
          onClose={() => setSkillModalOpen(false)}
          onCreated={onCreated}
        />
      )}

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span style={s.h1Repo}>{activeRepo?.name ?? t("page.repoFallback")}</span>
            </h1>
            <div style={s.subtitle}>
              {latestScan.data?.finished_at
                ? t("page.subtitleWithLastScan", {
                    when: new Date(latestScan.data.finished_at).toLocaleString(),
                  })
                : t("page.subtitle")}
            </div>
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            onClick={runScan}
            loading={isScanning}
            disabled={!repoId || isScanning}
          >
            {isScanning ? t("page.scanning") : t("page.rescan")}
          </Button>
        </div>

        {isScanning && (
          <div style={s.scanningBox}>
            <div style={s.scanningTitle}>
              <Icon.RefreshCw size={14} />
              {t("page.scanning")}
            </div>
            <div style={s.scanningTail}>
              {events.length === 0
                ? t("page.scanningHint")
                : events
                    .slice(-6)
                    .map((e) => `[${e.t}] ${e.msg}`)
                    .join("\n")}
            </div>
          </div>
        )}

        {/* Action row appears once we have any candidates. */}
        {candidates.length > 0 && (
          <div style={s.actionRow}>
            <span style={s.counter}>
              {t("page.acceptedCounter", {
                accepted: acceptedIds.length,
                total: candidates.length,
              })}
            </span>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              onClick={() => setSelectedIds(new Set())}
              disabled={selectedIds.size === 0}
            >
              {t("page.deselectAll")}
            </Button>
            <div style={s.spacer} />
            <Button
              kind="primary"
              size="sm"
              icon="Sparkles"
              onClick={() => setSkillModalOpen(true)}
              disabled={selectedCandidates.length === 0 || createSkillMut.isPending}
            >
              {t("page.createSkill", { count: selectedCandidates.length })}
            </Button>
          </div>
        )}

        {/* States */}
        {conventions.isLoading && (
          <div style={s.list}>
            <Skeleton height={150} />
            <Skeleton height={150} />
            <Skeleton height={150} />
          </div>
        )}
        {conventions.isError && (
          <ErrorState
            body={t("page.loadError")}
            onRetry={() => conventions.refetch()}
          />
        )}
        {!conventions.isLoading && !conventions.isError && candidates.length === 0 && !isScanning && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runScan}
          />
        )}

        {candidates.length > 0 && (
          <div style={s.list}>
            {candidates.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                selected={selectedIds.has(c.id)}
                onToggleSelect={() => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  });
                }}
                onAccept={() => onAccept(c.id)}
                onReject={() => onReject(c.id)}
                onSaveRule={(rule) => onSaveRule(c.id, rule)}
                busy={updateOne.isPending}
                repoFullName={activeRepo?.full_name}
                defaultBranch={activeRepo?.default_branch}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
