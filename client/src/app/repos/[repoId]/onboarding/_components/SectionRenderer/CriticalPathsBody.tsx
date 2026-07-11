/* critical_paths body: prose (one "why it matters" caption per link, per
 * AC-4) followed by the compact Open-link list for `section.links`. */
"use client";

import { Markdown } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { OnboardingLinks } from "../OnboardingLinks/OnboardingLinks";

export function CriticalPathsBody({
  section,
  repoFullName,
  sha,
  openLabel,
}: {
  section: OnboardingSection;
  repoFullName: string | null;
  sha: string;
  openLabel: string;
}) {
  return (
    <>
      <Markdown>{section.body}</Markdown>
      <OnboardingLinks
        links={section.links}
        repoFullName={repoFullName}
        sha={sha}
        openLabel={openLabel}
      />
    </>
  );
}
