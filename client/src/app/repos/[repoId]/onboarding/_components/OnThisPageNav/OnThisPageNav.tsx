/* OnThisPageNav — the sticky left-rail "ON THIS PAGE" nav (replaces the
 * header's old inline `<nav>`, carrying AC-17/AC-19's keyboard-reachable
 * anchor-nav coverage). One real `<a href="#kind">` per section — same set
 * the header nav used (`data.sections`, icon + `sectionNav.${kind}` label,
 * falling back to `section.title` for an unknown kind).
 *
 * Active link tracks scroll position via `IntersectionObserver` over the
 * `#${kind}` section elements. jsdom does not implement
 * `IntersectionObserver` (client/INSIGHTS.md) — feature-detected below so
 * the component still renders all links (just without the live active
 * state) under test. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { ONBOARDING_SECTION_ICONS, isOnboardingSectionKind } from "../../_lib/sections";

export function OnThisPageNav({ sections }: { sections: OnboardingSection[] }) {
  const t = useTranslations("onboarding");
  const [activeKind, setActiveKind] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const elements = sections
      .map((section) => document.getElementById(section.kind))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        // Prefer the visible section closest to the top of the viewport —
        // matches "what the reader is currently looking at" better than the
        // largest-intersection-ratio heuristic when sections are tall.
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setActiveKind(top.target.id);
      },
      { rootMargin: "0px 0px -70% 0px", threshold: [0, 1] },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav aria-label={t("header.anchorNavLabel")} style={navStyle}>
      <div style={labelStyle}>{t("onThisPage")}</div>
      {sections.map((section) => {
        const icon = isOnboardingSectionKind(section.kind)
          ? ONBOARDING_SECTION_ICONS[section.kind]
          : "FileText";
        const I = Icon[icon];
        const label = isOnboardingSectionKind(section.kind)
          ? t(`sectionNav.${section.kind}`)
          : section.title;
        const active = activeKind === section.kind;
        return (
          <a
            key={section.kind}
            href={`#${section.kind}`}
            style={{ ...linkStyle, ...(active ? activeLinkStyle : undefined) }}
          >
            <I size={13} />
            {label}
          </a>
        );
      })}
    </nav>
  );
}

const navStyle: React.CSSProperties = {
  position: "sticky",
  top: 16,
  display: "flex",
  flexDirection: "column",
  alignSelf: "start",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  padding: "0 0 8px 12px",
};

const linkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "var(--text-secondary)",
  textDecoration: "none",
  padding: "6px 0 6px 12px",
  borderLeft: "2px solid transparent",
};

const activeLinkStyle: React.CSSProperties = {
  color: "var(--accent-text)",
  borderLeft: "2px solid var(--accent)",
};
