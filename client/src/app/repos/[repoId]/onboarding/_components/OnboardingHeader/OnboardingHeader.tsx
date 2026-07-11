/* OnboardingHeader — title/subtitle/badges/Regenerate/Share. The anchor
 * nav that used to live here moved to the sticky left rail
 * (`OnThisPageNav`, AC-17/AC-19) — this header is now just the top row of
 * the content column. Rendered only once an artifact exists (fresh, stale,
 * or a degraded skeleton) — the "never generated yet" state is a separate
 * EmptyState in OnboardingBody, matching the pre-seeded `generate.*` i18n
 * block. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { OnboardingResponse } from "@devdigest/shared";
import { describeRelativeTime } from "../../_lib/format";
import { onboardingDegradedReasonLabel } from "../../_lib/degradedReason";

export function OnboardingHeader({
  repoName,
  data,
  onRegenerate,
  regenerating,
}: {
  repoName: string;
  data: OnboardingResponse;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const t = useTranslations("onboarding");

  const rel = describeRelativeTime(data.generatedAt);
  const relative =
    rel.unit === "now"
      ? t("header.justNow")
      : rel.unit === "minutes"
        ? t("header.minutesAgo", { minutes: rel.value })
        : rel.unit === "hours"
          ? t("header.hoursAgo", { hours: rel.value })
          : t("header.daysAgo", { days: rel.value });

  const degradedReason = onboardingDegradedReasonLabel(t, data.degradedReason);

  return (
    <header style={wrapStyle}>
      <div style={topRowStyle}>
        <div style={{ minWidth: 0 }}>
          <h1 style={h1Style}>
            {t("header.titlePrefix")}
            <span className="mono" style={repoChipStyle}>
              {repoName}
            </span>
          </h1>
          <div style={subtitleStyle}>
            {t("header.subtitle", { count: data.filesIndexed, relative })}
          </div>
          <div style={badgeRowStyle}>
            <Badge
              icon={data.status === "fresh" ? "Check" : "History"}
              color={data.status === "fresh" ? "var(--ok)" : "var(--warn)"}
              bg={data.status === "fresh" ? "var(--ok-bg)" : "var(--warn-bg)"}
            >
              {data.status === "fresh" ? t("header.statusFresh") : t("header.statusStale")}
            </Badge>
            {data.degraded && (
              <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
                {t("degraded.badge")}
                {degradedReason ? ` — ${degradedReason}` : ""}
              </Badge>
            )}
          </div>
        </div>

        <div style={actionsStyle}>
          <Button
            kind="secondary"
            icon="RefreshCw"
            onClick={onRegenerate}
            loading={regenerating}
            disabled={regenerating}
          >
            {regenerating ? t("regenerating") : t("regenerate")}
          </Button>
          <Button
            kind="ghost"
            icon="ExternalLink"
            disabled
            title={t("header.shareTooltip")}
          >
            {t("header.share")}
          </Button>
        </div>
      </div>
    </header>
  );
}

const wrapStyle: React.CSSProperties = { marginBottom: 8 };

const topRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
};

const h1Style: React.CSSProperties = {
  fontSize: 23,
  fontWeight: 700,
  margin: 0,
  color: "var(--text-primary)",
};

const repoChipStyle: React.CSSProperties = {
  color: "var(--accent-text)",
  background: "var(--bg-hover)",
  padding: "2px 8px",
  borderRadius: 6,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
  marginTop: 6,
};

const badgeRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 8,
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexShrink: 0,
};
