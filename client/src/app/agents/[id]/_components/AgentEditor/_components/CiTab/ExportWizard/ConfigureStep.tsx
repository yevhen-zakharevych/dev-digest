/* ConfigureStep — wizard step 3/4. Trigger selection (AC-23 client half),
   post-results choice, base branch, and two STATIC reference blocks:

   - Secrets (AC-44): reference text only — which secret is user-supplied
     (the model key) vs Actions-provided (`GITHUB_TOKEN`). No "ready"/"not
     set" pill: GitHub's API cannot be asked whether a repo secret exists, so
     such a pill would be a lie. This component makes no request of any kind
     — it renders identically for every repository, every time it mounts.
   - Blocking (AC-45): explains that blocking a merge needs "Fail CI on"
     (the CI tab's own control, not this wizard) PLUS a required branch-
     protection check — no GitHub App, ever. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, FormField, Icon, SelectInput, TextInput } from "@devdigest/ui";
import { DEFAULT_TRIGGERS, type TriggerKey } from "./wizard.helpers";

type PostAs = "github_review" | "pr_comment" | "none";

export function ConfigureStep({
  triggers,
  onToggleTrigger,
  postAs,
  onPostAsChange,
  base,
  onBaseChange,
}: {
  triggers: string[];
  onToggleTrigger: (trigger: TriggerKey) => void;
  postAs: PostAs;
  onPostAsChange: (postAs: PostAs) => void;
  base: string;
  onBaseChange: (base: string) => void;
}) {
  const t = useTranslations("ci");

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4 }}>
      <FormField label={t("exportWizard.triggerLabel")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {DEFAULT_TRIGGERS.map((trig) => (
            <Checkbox
              key={trig}
              checked={triggers.includes(trig)}
              onChange={() => onToggleTrigger(trig)}
              label={t(`exportWizard.triggers.${trig}`)}
            />
          ))}
        </div>
        {triggers.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--crit)", marginTop: 8 }}>
            {t("exportWizard.triggersRequired")}
          </div>
        )}
      </FormField>

      <FormField label={t("exportWizard.postResultsLabel")}>
        <SelectInput
          value={postAs}
          onChange={(v) => onPostAsChange(v as PostAs)}
          options={[
            { value: "github_review", label: t("exportWizard.postAs.githubReview") },
            { value: "pr_comment", label: t("exportWizard.postAs.prComment") },
            { value: "none", label: t("exportWizard.postAs.none") },
          ]}
        />
      </FormField>

      <FormField label={t("exportWizard.baseLabel")}>
        <TextInput value={base} onChange={onBaseChange} mono />
      </FormField>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 14,
          background: "var(--bg-elevated)",
          marginTop: 8,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{t("exportWizard.secrets.heading")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
          <div>
            <span className="mono">{t("exportWizard.secrets.modelKeyName")}</span>
            <div style={{ color: "var(--text-muted)" }}>{t("exportWizard.secrets.modelKeyDesc")}</div>
          </div>
          <div>
            <span className="mono">{t("exportWizard.secrets.githubTokenName")}</span>
            <div style={{ color: "var(--text-muted)" }}>{t("exportWizard.secrets.githubTokenDesc")}</div>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8 }}>
          {t("exportWizard.secrets.note")}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
          fontSize: 12.5,
          color: "var(--text-secondary)",
          marginTop: 12,
        }}
      >
        <Icon.Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("exportWizard.blocking.title")}</div>
          <div>{t("exportWizard.blocking.body")}</div>
        </div>
      </div>
    </div>
  );
}
