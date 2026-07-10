/* reading_path body: prose (files ordered by rank, one rationale line each —
 * ordering is entirely server-side per AC-6, the client never re-sorts)
 * followed by the same compact Open-link list used by critical_paths. */
"use client";

import { Markdown } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { OnboardingLinks } from "../OnboardingLinks/OnboardingLinks";

export function ReadingPathBody({
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
