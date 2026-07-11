/* RiskAreasCard — Why+Risk Brief (L06) "Risk areas" block. Reads the SAME
   `usePrBrief(prId)` query key as `PrBriefCard`/`ReviewFocusCard` (dedupes
   onto one fetch/cache entry) and renders the `risks[]` array that was
   computed and grounded server-side but never surfaced in the UI until now.

   Rendered by `OverviewTab` stacked directly under `IntentCard`, in the SAME
   grid column (not merged into `IntentCard` itself — that card reads only
   `usePrIntent` and stays that way; this is a deliberate second, separate
   card composed at the `OverviewTab` level so the two data sources/loading
   states stay independent, per the design review that rejected merging them).

   Each risk is a collapsible row (mirrors BlastRadiusCard's `SymbolRow`
   `<details>/<summary>` idiom), severity-colored via the shared
   `RISK_LEVEL_META` table (`../../_lib/riskLevel.constants.ts`). Its file/
   endpoint reference chip(s) are rendered INSIDE `<summary>` — not the
   collapsible body — so they stay visible while the row is collapsed
   (matches the design mock); clicking a chip calls `preventDefault()` so it
   opens the file in-app instead of toggling the row. Renders nothing when
   there is no brief yet, or the brief has no risks — purely additive, same
   rule as `ReviewFocusCard`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SectionLabel } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks/brief";
import type { BriefRisk, BriefRiskReference } from "@devdigest/shared";
import { RISK_LEVEL_META } from "../../_lib/riskLevel.constants";
import { s } from "./styles";

export interface RiskAreasCardProps {
  prId: string | number;
  /** Opens a risk's file reference in-app (same contract as
   * `ReviewFocusCard.onOpenFile`, threaded from page.tsx's `handleOpenFile`). */
  onOpenFile: (file: string) => void;
}

function refLabel(ref: BriefRiskReference): string {
  return typeof ref === "string" ? ref : ref.line != null ? `${ref.file}:${ref.line}` : ref.file;
}

function RiskRow({
  risk,
  onOpenFile,
}: {
  risk: BriefRisk;
  onOpenFile: (file: string) => void;
}) {
  const meta = RISK_LEVEL_META[risk.severity];
  const SeverityIcon = Icon[meta.icon];

  return (
    <details style={s.riskRow}>
      <summary style={s.riskSummary}>
        <div style={s.riskSummaryTop}>
          <Icon.ChevronRight size={13} style={s.chevron} />
          <SeverityIcon size={14} style={s.severityIcon(meta.color)} />
          <span style={s.riskTitle}>{risk.title}</span>
        </div>
        {risk.references.length > 0 && (
          <div style={s.refsRow}>
            {risk.references.map((ref, i) =>
              typeof ref === "string" ? (
                <span key={i} className="mono" style={s.refChipStatic} title={refLabel(ref)}>
                  {refLabel(ref)}
                </span>
              ) : (
                <button
                  key={i}
                  type="button"
                  className="mono"
                  style={s.refChip}
                  title={refLabel(ref)}
                  onClick={(e) => {
                    // Prevent the click's default action from toggling the
                    // parent <details> (nested-interactive-in-summary, same
                    // problem MonoLink's href variant guards against).
                    e.preventDefault();
                    onOpenFile(ref.file);
                  }}
                >
                  {refLabel(ref)}
                </button>
              ),
            )}
          </div>
        )}
      </summary>

      <div style={s.riskBody}>
        <p style={s.explanation}>{risk.explanation}</p>
      </div>
    </details>
  );
}

export function RiskAreasCard({ prId, onOpenFile }: RiskAreasCardProps) {
  const t = useTranslations("brief");
  const { data } = usePrBrief(prId);
  const risks = data?.brief?.risks ?? [];

  if (risks.length === 0) return null;

  return (
    <section style={s.wrap} data-testid="risk-areas-card">
      <SectionLabel icon="AlertTriangle" right={<Badge mono>{risks.length}</Badge>}>
        {t("riskAreas")}
      </SectionLabel>
      <div style={s.list}>
        {risks.map((risk, i) => (
          <RiskRow key={`${risk.title}:${i}`} risk={risk} onOpenFile={onOpenFile} />
        ))}
      </div>
    </section>
  );
}
