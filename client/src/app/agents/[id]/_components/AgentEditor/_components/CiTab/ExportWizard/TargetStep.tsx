/* TargetStep — wizard step 1/4. Target-type selection (AC-1, AC-2) + the
   free-text repo field (AC-3, AC-4 client half). Presentational only: all
   state lives in the parent `ExportWizard`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, TextInput, type IconName } from "@devdigest/ui";
import type { CiTarget } from "@devdigest/shared";
import { DISABLED_TARGETS, isValidRepoName } from "./wizard.helpers";

const ALL_TARGETS: readonly CiTarget[] = ["gha", "circle", "jenkins", "cli"];

const TARGET_ICON: Record<CiTarget, IconName> = {
  gha: "Workflow",
  circle: "RefreshCw",
  jenkins: "Boxes",
  cli: "Code",
};

export function TargetStep({
  target,
  repo,
  onSelectTarget,
  onRepoChange,
}: {
  target: CiTarget;
  repo: string;
  onSelectTarget: (target: CiTarget) => void;
  onRepoChange: (repo: string) => void;
}) {
  const t = useTranslations("ci");
  const trimmedRepo = repo.trim();
  const repoValid = isValidRepoName(repo);
  const showRepoError = trimmedRepo.length > 0 && !repoValid;

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        role="radiogroup"
        aria-label={t("exportWizard.title")}
        style={{ display: "flex", gap: 12, flexWrap: "wrap" }}
      >
        {ALL_TARGETS.map((tgt) => {
          const disabled = DISABLED_TARGETS.includes(tgt);
          const selected = target === tgt;
          const TargetIcon = Icon[TARGET_ICON[tgt]];
          return (
            <button
              key={tgt}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onSelectTarget(tgt)}
              style={{
                flex: "1 1 170px",
                textAlign: "left",
                padding: 14,
                borderRadius: 10,
                border: "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
                background: selected ? "var(--accent-bg)" : "var(--bg-elevated)",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TargetIcon size={16} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t(`exportWizard.targets.${tgt}`)}</span>
              </div>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t(`exportWizard.targets.${tgt}Desc`)}
              </span>
              {tgt === "gha" && (
                <Badge color="var(--ok)" bg="var(--ok-bg)">
                  {t("exportWizard.recommended")}
                </Badge>
              )}
              {disabled && <Badge color="var(--text-muted)">{t("exportWizard.comingSoon")}</Badge>}
            </button>
          );
        })}
      </div>

      <div>
        <label
          htmlFor="ci-export-repo"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            display: "block",
            marginBottom: 8,
          }}
        >
          {t("exportWizard.repoLabel")}
        </label>
        <TextInput
          id="ci-export-repo"
          value={repo}
          onChange={onRepoChange}
          placeholder={t("exportWizard.repoPlaceholder")}
          mono
          aria-invalid={showRepoError}
        />
        <div
          style={{ fontSize: 12, color: showRepoError ? "var(--crit)" : "var(--text-muted)", marginTop: 8 }}
        >
          {showRepoError ? t("exportWizard.repoInvalid") : t("exportWizard.repoHint")}
        </div>
      </div>
    </div>
  );
}
