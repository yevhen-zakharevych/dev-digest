/* SectionRenderer — one `<section>` per `OnboardingSection`: an anchor
 * target (`id={kind}`, landed on by `OnThisPageNav`), wrapping a `Card`
 * whose header shows an icon-square + the model/skeleton-produced `title`
 * (AC-1: non-deterministic prose, so NOT the fixed i18n nav label) plus a
 * collapse chevron, and whose body is the kind-specific renderer. Unknown
 * kinds (should not occur post server-side normalization, AC-2) fall back
 * to plain markdown rather than being silently dropped. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, Icon, Markdown } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { ONBOARDING_SECTION_ICONS, isOnboardingSectionKind } from "../../_lib/sections";
import type { ComplexityLevel } from "../../_lib/complexity";
import { ArchitectureBody } from "./ArchitectureBody";
import { CriticalPathsBody } from "./CriticalPathsBody";
import { RunLocallyBody } from "./RunLocallyBody";
import { ReadingPathBody } from "./ReadingPathBody";
import { FirstTasksBody } from "./FirstTasksBody";

export function SectionRenderer({
  section,
  repoFullName,
  sha,
}: {
  section: OnboardingSection;
  repoFullName: string | null;
  sha: string;
}) {
  const t = useTranslations("onboarding");
  const openLabel = t("links.open");
  const kind = section.kind;
  const icon = isOnboardingSectionKind(kind) ? ONBOARDING_SECTION_ICONS[kind] : "FileText";
  const I = Icon[icon];
  const complexityLabel = (level: ComplexityLevel) => t(`complexity.${level.toLowerCase()}`);
  const [open, setOpen] = React.useState(true);

  return (
    <section id={kind} style={sectionStyle} data-testid={`onboarding-section-${kind}`}>
      <Card>
        <div style={headerRowStyle}>
          <div style={titleGroupStyle}>
            <div style={iconSquareStyle}>
              <I size={16} style={{ color: "var(--text-secondary)" }} />
            </div>
            <h2 style={headingStyle}>{section.title}</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            title={open ? t("section.collapse") : t("section.expand")}
            aria-label={open ? t("section.collapse") : t("section.expand")}
            style={chevronBtnStyle}
          >
            <Icon.ChevronDown
              size={16}
              style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
            />
          </button>
        </div>
        {open && (
          <div style={bodyStyle}>
            {kind === "architecture" && <ArchitectureBody section={section} />}
            {kind === "critical_paths" && (
              <CriticalPathsBody
                section={section}
                repoFullName={repoFullName}
                sha={sha}
                openLabel={openLabel}
              />
            )}
            {kind === "run_locally" && (
              <RunLocallyBody
                section={section}
                copyLabel={t("runLocally.copyStep")}
                copiedLabel={t("runLocally.copiedStep")}
              />
            )}
            {kind === "reading_path" && (
              <ReadingPathBody
                section={section}
                repoFullName={repoFullName}
                sha={sha}
                openLabel={openLabel}
              />
            )}
            {kind === "first_tasks" && (
              <FirstTasksBody
                section={section}
                repoFullName={repoFullName}
                sha={sha}
                openLabel={openLabel}
                complexityLabel={complexityLabel}
              />
            )}
            {!isOnboardingSectionKind(kind) && <Markdown>{section.body}</Markdown>}
          </div>
        )}
      </Card>
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  scrollMarginTop: 16,
};

const headerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const titleGroupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
};

const iconSquareStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  flexShrink: 0,
  borderRadius: 7,
  background: "var(--bg-hover)",
  display: "grid",
  placeItems: "center",
};

const headingStyle: React.CSSProperties = {
  fontSize: 15.5,
  fontWeight: 650,
  color: "var(--text-primary)",
  margin: 0,
  minWidth: 0,
};

const chevronBtnStyle: React.CSSProperties = {
  display: "inline-grid",
  placeItems: "center",
  width: 28,
  height: 28,
  flexShrink: 0,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const bodyStyle: React.CSSProperties = {
  borderTop: "1px solid var(--border)",
  marginTop: 14,
  paddingTop: 14,
};
