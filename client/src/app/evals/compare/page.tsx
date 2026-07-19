/* /evals/compare?a=<runId>&b=<runId> — compare two runs of one agent, and
   promote the winner (AC-24..28). Entered from the Evals tab's run history;
   `agentId` lets this page fall back to a run picker when reached without
   both run ids yet (Assumption A-4 — eval surfaces are pages, not modals). */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "../../../components/app-shell/AppShell";
import { EvalCompare } from "@/features/evals/components/EvalCompare/EvalCompare";

export default function EvalComparePage() {
  const t = useTranslations("eval.page");
  const router = useRouter();
  const search = useSearchParams();
  const runIdA = search.get("a");
  const runIdB = search.get("b");
  const agentId = search.get("agentId");

  const crumb = [{ label: t("crumbEvalDashboard"), href: "/evals" }, { label: t("crumbCompare") }];

  const onPick = (a: string, b: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("a", a);
    sp.set("b", b);
    router.replace(`/evals/compare?${sp.toString()}`);
  };

  return (
    <AppShell crumb={crumb}>
      <EvalCompare runIdA={runIdA} runIdB={runIdB} agentId={agentId} onPick={onPick} />
    </AppShell>
  );
}
