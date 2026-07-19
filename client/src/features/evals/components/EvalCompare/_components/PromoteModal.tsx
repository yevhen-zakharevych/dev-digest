"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { s } from "../styles";

export interface RegressionLine {
  label: string;
  from: string;
  to: string;
}

/**
 * AC-28: if the promoted side is worse on ANY metric, name it and require an
 * explicit confirmation — cancelling promotes nothing.
 */
export function PromoteModal({
  version,
  regressions,
  isPending,
  onConfirm,
  onClose,
}: {
  version: string;
  regressions: RegressionLine[];
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const metricNames = regressions.map((r) => r.label).join(", ");

  return (
    <Modal title={t("compare.promoteRegressionTitle", { metric: metricNames })} onClose={onClose} width={460}>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        {regressions.map((r) => (
          <p key={r.label}>{t("compare.promoteRegressionBody", { metric: r.label, from: r.from, to: r.to })}</p>
        ))}
        <div style={s.modalFooter}>
          <Button kind="ghost" onClick={onClose}>
            {t("compare.promoteCancel")}
          </Button>
          <Button kind="danger" loading={isPending} onClick={onConfirm}>
            {t("compare.promoteConfirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
