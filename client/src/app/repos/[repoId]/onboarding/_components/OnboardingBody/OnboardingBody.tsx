/* OnboardingBody — the data-driven part of the Onboarding page: loading/
 * error/"never generated"/generating/artifact states, wiring the GET query,
 * the generate/regenerate mutation, and the SSE run-progress subscription.
 * Split out from OnboardingView (which owns AppShell + the repo-not-found
 * guard) so this piece is unit-testable without standing up the whole app
 * shell — same split as `ProjectContextBody`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import {
  useOnboarding,
  useGenerateOnboarding,
  isOnboardingScanResult,
} from "@/lib/hooks/onboarding";
import { useRunEvents } from "@/lib/hooks/reviews";
import { useActiveRepo } from "@/lib/repo-context";
import { notify } from "@/lib/toast";
import { OnboardingHeader } from "../OnboardingHeader/OnboardingHeader";
import { OnThisPageNav } from "../OnThisPageNav/OnThisPageNav";
import { GenerationProgress } from "../GenerationProgress/GenerationProgress";
import { SectionRenderer } from "../SectionRenderer/SectionRenderer";
import { s } from "./styles";

const SKELETON_ROWS = 4;

export function OnboardingBody({ repoId }: { repoId: string }) {
  const t = useTranslations("onboarding");
  const { activeRepo } = useActiveRepo();
  const repoName = activeRepo?.full_name ?? repoId;

  const onboarding = useOnboarding(repoId);
  const generate = useGenerateOnboarding();

  // Session-local scanId for the async full-generation path's live SSE
  // subscription (the "scan id doubling as the SSE run id" pattern, AC-18).
  // Ephemeral — lost on reload. A boolean-only `generating` flag on the GET
  // response (no scanId) can't re-subscribe SSE after a reload
  // (client/INSIGHTS.md:92-93); `reloadGenerating` below covers that case
  // with a scanId-less progress state instead.
  const [activeScanId, setActiveScanId] = React.useState<string | null>(null);
  const { events, running } = useRunEvents(activeScanId ? [activeScanId] : []);

  // SSE stream finished → the artifact is ready; drop the local scanId and
  // refetch the persisted GET to pick it up.
  React.useEffect(() => {
    if (!activeScanId) return;
    if (!running && events.length > 0) {
      setActiveScanId(null);
      void onboarding.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, events.length, activeScanId]);

  const reloadGenerating = !activeScanId && onboarding.data?.generating === true;
  const isGenerating = !!activeScanId || reloadGenerating;

  const handleGenerate = async (force: boolean) => {
    try {
      const result = await generate.mutateAsync({ repoId, force });
      // Async full-generation path: subscribe to SSE. The synchronous
      // degraded path already wrote its artifact into the GET cache inside
      // the mutation hook's onSuccess — no scanId, no SSE progress ever
      // renders for it (plan §13 Gap 3).
      if (isOnboardingScanResult(result)) {
        setActiveScanId(result.scanId);
      }
    } catch (err) {
      notify.error((err as Error).message || t("unknownError"));
    }
  };

  if (onboarding.isLoading) {
    return (
      <div style={s.stateWrap}>
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <Skeleton key={i} height={44} />
        ))}
      </div>
    );
  }

  if (onboarding.isError) {
    return (
      <div style={s.stateWrap}>
        <ErrorState title={t("loadError.title")} onRetry={() => onboarding.refetch()} />
      </div>
    );
  }

  const data = onboarding.data ?? null;

  // Never generated yet — no artifact, no header, no anchor nav (AC-11/16:
  // useful state, never an empty screen; AC-18 still applies once a run is
  // in flight — the progress panel alone is the non-dismissible state).
  if (!data) {
    if (isGenerating) {
      return (
        <div style={s.page}>
          <GenerationProgress
            title={t("progress.title")}
            hint={t("progress.hint")}
            events={activeScanId ? events : undefined}
          />
        </div>
      );
    }
    return (
      <div style={s.stateWrap}>
        <EmptyState
          icon="Sparkles"
          title={t("generate.title")}
          body={t("generate.body")}
          cta={t("generate.cta")}
          onCta={() => void handleGenerate(false)}
          ctaLoading={generate.isPending}
        />
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.grid}>
        <div style={s.rail}>
          <OnThisPageNav sections={data.sections} />
        </div>
        <div style={s.content}>
          <OnboardingHeader
            repoName={repoName}
            data={data}
            onRegenerate={() => void handleGenerate(true)}
            regenerating={isGenerating || generate.isPending}
          />
          {isGenerating && (
            <GenerationProgress
              title={t("progress.title")}
              hint={t("progress.hint")}
              events={activeScanId ? events : undefined}
            />
          )}
          <div style={s.sections}>
            {data.sections.map((section) => (
              <SectionRenderer
                key={section.kind}
                section={section}
                repoFullName={activeRepo?.full_name ?? null}
                sha={data.indexedSha}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
