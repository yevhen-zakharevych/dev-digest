"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, Button, Skeleton } from "@devdigest/ui";
import { usePrIntent, useRecomputeIntent } from "@/lib/hooks/brief";
import { s } from "./styles";

/** INTENT card — PR Overview tab. Renders the stored `Intent` (summary quote
   + IN SCOPE + OUT OF SCOPE) with a "Recompute" action. Intent-only scope:
   no Risk Areas chips (separate `risk_brief` feature). */
export function IntentCard({ prId }: { prId: string | number }) {
  const t = useTranslations("brief");
  const { data: intent, isLoading } = usePrIntent(prId);
  const recompute = useRecomputeIntent();

  const recomputeButton = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      loading={recompute.isPending}
      onClick={() => recompute.mutate({ prId })}
    >
      {recompute.isPending ? t("recomputing") : t("recompute")}
    </Button>
  );

  if (isLoading) {
    return (
      <section style={s.wrap}>
        <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
        <Skeleton height={16} width={280} />
        <Skeleton height={14} width={180} />
      </section>
    );
  }

  if (!intent) {
    return (
      <section style={s.wrap}>
        <SectionLabel icon="Target" right={recomputeButton}>
          {t("block.intent")}
        </SectionLabel>
        <p style={s.loadingText}>{t("unavailable")}</p>
        <p style={s.loadingText}>{t("unavailableHint")}</p>
      </section>
    );
  }

  return (
    <section style={s.wrap}>
      <SectionLabel icon="Target" right={recomputeButton}>
        {t("block.intent")}
      </SectionLabel>

      <p style={s.quote}>&ldquo;{intent.intent}&rdquo;</p>

      <div style={s.scopeGrid}>
        <div style={s.scopeCol}>
          <span style={s.scopeHeading}>{t("inScope")}</span>
          {intent.in_scope.length > 0 ? (
            <ul style={s.scopeList}>
              {intent.in_scope.map((item, i) => (
                <li key={i} style={s.scopeItem}>
                  <Icon.Check size={14} style={s.inScopeIcon} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span style={s.emptyDash}>—</span>
          )}
        </div>

        <div style={s.scopeCol}>
          <span style={s.scopeHeading}>{t("outOfScope")}</span>
          {intent.out_of_scope.length > 0 ? (
            <ul style={s.scopeList}>
              {intent.out_of_scope.map((item, i) => (
                <li key={i} style={s.outOfScopeItem}>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span style={s.emptyDash}>—</span>
          )}
        </div>
      </div>
    </section>
  );
}
