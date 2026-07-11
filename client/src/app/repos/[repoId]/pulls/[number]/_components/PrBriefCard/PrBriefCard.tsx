/* PrBriefCard — Why+Risk Brief (L06). Renders the persisted per-PR brief as a
   COMPACT HORIZONTAL BANNER (mirrors VerdictBanner.tsx's shape: icon box +
   label + summary meta on the left, score ring + cost on the right) — NOT a
   review-focus list (that moved to the sibling `ReviewFocusCard`, which reads
   the same `usePrBrief(prId)` query key and renders at the bottom of the
   Overview tab). This card owns: the risk_level-colored icon + text label
   (AC-12), the what/why summary, an icon-only Regenerate control (Onboarding
   fresh/stale + disabled-while-in-flight pattern, OnboardingHeader.tsx:56-90),
   the brief call's OWN cost/token readout (RunCostBadge variant="detailed"),
   and the review-run's findings/blockers meta line (mirrors
   ReviewRunAccordion.tsx:60's blocking-severity derivation).

   `risk_level` is rendered independently of any review score (AC-11) — the
   score ring is shown ONLY when `usePrReviews` has a completed run with a
   non-null score (mirrors VerdictBanner.tsx:50's `score != null` guard); no
   review present still renders what/why/risk_level, no ring.

   The GET is a non-null `BriefResponse` wrapper discriminated by `status`
   (fresh/stale/not_generated/degraded) — a deliberate deviation from the
   usual `T | null` lazily-computed-artifact shape (client/INSIGHTS.md:21),
   documented in docs/plans/L06-why-risk-brief.md §7. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  CircularScore,
  EmptyState,
  Icon,
  RunCostBadge,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import { usePrBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { usePrReviews } from "@/lib/hooks/reviews";
import { degradedReasonLabel } from "./PrBriefCard.helpers";
import { RISK_LEVEL_META } from "../../_lib/riskLevel.constants";

export interface PrBriefCardProps {
  prId: string | number;
  /** Kept for signature parity with the sibling Overview cards
   * (`BlastRadiusCard`); not needed by this card's own reads. */
  repoId?: string | null;
}

export function PrBriefCard({ prId }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading } = usePrBrief(prId);
  const generate = useGenerateBrief();
  const { data: reviews } = usePrReviews(String(prId));

  const latestRun = reviews?.[0] ?? null;
  const showScoreRing = latestRun != null && latestRun.score != null;
  // Secondary meta line next to the risk heading — only when the latest run's
  // findings are on the record (they always are on a `ReviewRecord`); blocking
  // severity mirrors ReviewRunAccordion.tsx:60, NOT reconciled with risk_level
  // (AC-11: risk_level stays an independent judgement).
  const findingsMeta = latestRun
    ? {
        count: latestRun.findings.length,
        blockers: latestRun.findings.filter(
          (f) => f.severity === "CRITICAL" && !f.dismissed_at,
        ).length,
      }
    : null;

  const regenerating = generate.isPending;
  const handleGenerate = (force: boolean) => generate.mutate({ prId, force });

  if (isLoading) {
    return (
      <section style={s.wrap} data-testid="pr-brief-card">
        <SectionLabel icon="FileText">{t("card.title")}</SectionLabel>
        <Skeleton height={16} width={280} />
        <Skeleton height={60} />
      </section>
    );
  }

  if (!data || data.status === "not_generated") {
    return (
      <section style={s.wrap} data-testid="pr-brief-card">
        <SectionLabel icon="FileText">{t("card.title")}</SectionLabel>
        <EmptyState
          icon="Sparkles"
          title={t("notGenerated.title")}
          body={t("notGenerated.body")}
          cta={t("generate")}
          onCta={() => handleGenerate(false)}
          ctaLoading={regenerating}
        />
      </section>
    );
  }

  const brief = data.brief ?? null;
  const degradedMessage =
    data.status === "degraded" ? degradedReasonLabel(t, data.degraded_reason) : null;

  const regenerateButton = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      loading={regenerating}
      disabled={regenerating}
      aria-label={regenerating ? t("regenerating") : t("regenerate")}
      onClick={() => handleGenerate(true)}
    />
  );

  // Degraded and nothing was ever generated before — no brief to fall back
  // to (AC-16 preserves a PRIOR brief; there is none here).
  if (!brief) {
    return (
      <section style={s.wrap} data-testid="pr-brief-card">
        <SectionLabel icon="FileText" right={regenerateButton}>
          {t("card.title")}
        </SectionLabel>
        <EmptyState
          icon="AlertTriangle"
          title={t("degraded.title")}
          body={degradedMessage ?? t("degraded.genericBody")}
        />
      </section>
    );
  }

  const risk = RISK_LEVEL_META[brief.risk_level];
  const RiskIcon = Icon[risk.icon];

  return (
    <section style={s.wrap} data-testid="pr-brief-card">
      <SectionLabel icon="FileText">{t("card.title")}</SectionLabel>

      <div style={s.banner}>
        <div style={s.iconBox(risk.bg, risk.color)}>
          <RiskIcon size={20} />
        </div>

        <div style={s.main}>
          <div style={s.titleRow}>
            <span data-testid="pr-brief-risk-banner" style={s.label(risk.color)}>
              {t(`riskLevel.${brief.risk_level}`)}
            </span>
            {data.status === "stale" && (
              <Badge icon="History" color="var(--warn)" bg="var(--warn-bg)">
                {t("stale")}
              </Badge>
            )}
            {data.status === "degraded" && (
              <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
                {t("degraded.badge")}
                {degradedMessage ? ` — ${degradedMessage}` : ""}
              </Badge>
            )}
            {findingsMeta && (
              <span style={s.findingsMeta}>
                {t("findingsMeta", { count: findingsMeta.count })}
                {findingsMeta.blockers > 0
                  ? t("blockersMeta", { count: findingsMeta.blockers })
                  : ""}
              </span>
            )}
          </div>
          <p style={s.what}>{brief.what}</p>
          <p style={s.why}>{brief.why}</p>
        </div>

        <div style={s.rightCol}>
          {regenerateButton}
          {showScoreRing && latestRun && (
            <div style={s.scoreCol}>
              <CircularScore score={latestRun.score as number} size={40} stroke={4} />
              <span style={s.scoreLabel}>{t("reviewScore")}</span>
            </div>
          )}
          {data.cost && (
            <RunCostBadge
              variant="detailed"
              value={data.cost.usd}
              tokensIn={data.cost.tokens_in}
              tokensOut={data.cost.tokens_out}
            />
          )}
        </div>
      </div>
    </section>
  );
}

const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginBottom: 14,
  } as React.CSSProperties,
  banner: {
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } as React.CSSProperties,
  iconBox: (bg: string, color: string): React.CSSProperties => ({
    width: 34,
    height: 34,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: bg,
    color,
    flexShrink: 0,
  }),
  main: { flex: 1, minWidth: 0 } as React.CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } as React.CSSProperties,
  label: (color: string): React.CSSProperties => ({
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "0.01em",
    color,
  }),
  findingsMeta: {
    fontSize: 12,
    color: "var(--text-muted)",
  } as React.CSSProperties,
  what: {
    margin: "6px 0 0",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-primary)",
  } as React.CSSProperties,
  why: {
    margin: "2px 0 0",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } as React.CSSProperties,
  rightCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
    flexShrink: 0,
  } as React.CSSProperties,
  scoreCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  } as React.CSSProperties,
  scoreLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
  } as React.CSSProperties,
} as const;
