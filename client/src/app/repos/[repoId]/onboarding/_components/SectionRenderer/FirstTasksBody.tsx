/* first_tasks body: one block per candidate task, each grounded in
 * deterministic facts (untested files / TODO-FIXME — server-side, AC-7)
 * with a deterministic complexity badge (AC-8). The badge text is embedded
 * in the markdown body (the base contract carries no structured complexity
 * field — see the spec's non-goals); `extractComplexity` pulls the token
 * out so it can be rendered as an explicit `Badge` (icon + text label,
 * never colour alone — AC-8's a11y clause) alongside the task prose.
 * Falls back to plain markdown when the body has no bullet list (e.g. a
 * fixture repo with zero untested files and zero TODO/FIXME markers, which
 * legitimately yields no fabricated tasks — AC-7's edge case). */
"use client";

import { Badge, Markdown } from "@devdigest/ui";
import type { IconName } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { OnboardingLinks } from "../OnboardingLinks/OnboardingLinks";
import { extractComplexity, splitTaskBlocks, type ComplexityLevel } from "../../_lib/complexity";

const COMPLEXITY_ICON: Record<ComplexityLevel, IconName> = {
  Low: "Check",
  Medium: "AlertTriangle",
  High: "AlertOctagon",
};

const COMPLEXITY_COLOR: Record<ComplexityLevel, { color: string; bg: string }> = {
  Low: { color: "var(--ok)", bg: "var(--ok-bg)" },
  Medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  High: { color: "var(--crit)", bg: "var(--crit-bg)" },
};

export function FirstTasksBody({
  section,
  repoFullName,
  sha,
  openLabel,
  complexityLabel,
}: {
  section: OnboardingSection;
  repoFullName: string | null;
  sha: string;
  openLabel: string;
  /** `(level) => "Low" | "Medium" | "High"` translated label. */
  complexityLabel: (level: ComplexityLevel) => string;
}) {
  const blocks = splitTaskBlocks(section.body);

  if (blocks.length === 0) {
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

  return (
    <>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {blocks.map((block, i) => {
          const complexity = extractComplexity(block);
          return (
            <li key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Markdown>{block}</Markdown>
              {complexity && (
                <div>
                  <Badge
                    icon={COMPLEXITY_ICON[complexity]}
                    color={COMPLEXITY_COLOR[complexity].color}
                    bg={COMPLEXITY_COLOR[complexity].bg}
                  >
                    {complexityLabel(complexity)}
                  </Badge>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <OnboardingLinks
        links={section.links}
        repoFullName={repoFullName}
        sha={sha}
        openLabel={openLabel}
      />
    </>
  );
}
