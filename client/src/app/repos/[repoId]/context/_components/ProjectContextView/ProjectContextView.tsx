/* ProjectContextView — /repos/:repoId/context. Owns AppShell + the
   repo-not-found guard (mirrors `pulls/page.tsx`'s pattern). The two-pane
   master-detail layout (list left, selected document right), the Preview/Edit
   toggle, and the AC-7 footer live in ProjectContextBody, kept separate so
   that piece stays unit-testable without standing up the whole app shell.
   The page has no separate top title bar — the "Project Context" label lives
   in the left pane's own header (same house pattern as `SkillsListView`,
   whose left rail carries the page's h1 rather than a full-width header). */
"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell/AppShell";
import { RepoNotFound } from "@/components/RepoNotFound";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ProjectContextBody } from "../ProjectContextBody/ProjectContextBody";

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("projectContext");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const repoName = activeRepo?.full_name ?? repoId;

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: t("crumb") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: t("crumb") }]}>
      <ProjectContextBody repoId={repoId} />
    </AppShell>
  );
}
