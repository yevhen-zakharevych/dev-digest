"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { EvalRunAllPreview } from "@devdigest/shared";
import { s } from "../styles";

/**
 * "Run all agents" confirmation — names BOTH totals (agents + cases) before a
 * single model call is issued (AC-35). `preview.agents` already excludes
 * zero-case agents server-side; `totalAgentsOnDashboard` (all agents shown on
 * the workspace dashboard, cases or not) lets us name how many were skipped.
 */
export function RunAllModal({
  preview,
  totalAgentsOnDashboard,
  isPending,
  onConfirm,
  onClose,
}: {
  preview: EvalRunAllPreview | undefined;
  totalAgentsOnDashboard: number;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const agentsTotal = preview?.agents_total ?? 0;
  const casesTotal = preview?.cases_total ?? 0;
  const skipped = Math.max(0, totalAgentsOnDashboard - agentsTotal);

  return (
    <Modal title={t("dashboard.runAllConfirmTitle")} onClose={onClose} width={480}>
      <div style={s.modalBody}>
        <p>{t("dashboard.runAllConfirmBody", { agents: agentsTotal, cases: casesTotal })}</p>
        {skipped > 0 && <p style={s.emptyHint}>{t("dashboard.runAllSkipped", { count: skipped })}</p>}
        <div style={s.modalFooter}>
          <Button kind="ghost" onClick={onClose}>
            {t("caseEditor.cancel")}
          </Button>
          <Button kind="primary" icon="Play" loading={isPending} disabled={casesTotal === 0} onClick={onConfirm}>
            {t("dashboard.runAllConfirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
