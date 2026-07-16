/* /evals — workspace Eval Dashboard (AC-29). Repairs the sidebar's
   already-live "Eval Dashboard" entry (`vendor/ui/nav.ts:36`), which
   currently points at nothing — no nav edit needed here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "../../components/app-shell/AppShell";
import { EvalDashboard } from "./_components/EvalDashboard/EvalDashboard";

export default function EvalsDashboardPage() {
  const t = useTranslations("eval.page");
  const crumb = [{ label: t("crumbSkillsLab") }, { label: t("crumbEvalDashboard") }];
  return (
    <AppShell crumb={crumb}>
      <EvalDashboard />
    </AppShell>
  );
}
