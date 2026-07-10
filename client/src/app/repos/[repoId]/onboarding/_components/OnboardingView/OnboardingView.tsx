/* OnboardingView — /repos/:repoId/onboarding (Onboarding Tour, AC-19). Owns
 * AppShell + the repo-not-found guard, mirroring `ProjectContextView`'s
 * pattern. All data/state logic lives in OnboardingBody, kept separate so
 * that piece stays unit-testable without standing up the whole app shell. */
"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell/AppShell";
import { RepoNotFound } from "@/components/RepoNotFound";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { OnboardingBody } from "../OnboardingBody/OnboardingBody";

export function OnboardingView({ repoId }: { repoId: string }) {
  const t = useTranslations("onboarding");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const repoName = activeRepo?.full_name ?? repoId;

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: t("title") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: t("title") }]}>
      <OnboardingBody repoId={repoId} />
    </AppShell>
  );
}
