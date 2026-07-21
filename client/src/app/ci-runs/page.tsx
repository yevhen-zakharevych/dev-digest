/* /ci-runs — CI Runs page (AC-38 … AC-41). Repairs the sidebar's GLOBAL
   section entry (`vendor/ui/nav.ts`), which otherwise points at nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell/AppShell";
import { CiRunsTable } from "./_components/CiRunsTable/CiRunsTable";

export default function CiRunsPage() {
  const t = useTranslations("ci");
  const crumb = [{ label: t("page.crumb") }];
  return (
    <AppShell crumb={crumb}>
      <CiRunsTable />
    </AppShell>
  );
}
