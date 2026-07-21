/* InstallStep — wizard step 4/4. The one enabled action ("open a PR with
   these files") plus a disabled "copy as zip" card (AC-2's fourth disabled
   card, spec Non-goal / OQ-2). On success, a WORKING link to the opened PR
   (AC-28 UI half); on the runner-bundle failure (AC-8 UI half) the server's
   own message is shown and no success state is rendered. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon } from "@devdigest/ui";

export function InstallStep({
  repo,
  fileCount,
  prUrl,
  isPending,
  error,
  onInstall,
}: {
  repo: string;
  fileCount: number;
  prUrl: string | null;
  isPending: boolean;
  error: Error | null;
  onInstall: () => void;
}) {
  const t = useTranslations("ci");

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, background: "var(--bg-elevated)" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{t("exportWizard.installCardTitle")}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {t("exportWizard.installCardBody", { repo, count: fileCount })}
        </div>
      </div>

      {/* Disabled "copy as a zip" card — AC-2 / spec Non-goal, OQ-2. */}
      <div
        aria-disabled="true"
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 14,
          background: "var(--bg-elevated)",
          opacity: 0.55,
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{t("exportWizard.zipCardTitle")}</div>
        <Badge color="var(--text-muted)">{t("exportWizard.zipCardHint")}</Badge>
      </div>

      {error && <div style={{ fontSize: 13, color: "var(--crit)" }}>{error.message}</div>}

      {prUrl ? (
        <a
          href={prUrl}
          target="_blank"
          rel="noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5, color: "var(--accent)" }}
        >
          <Icon.ExternalLink size={14} />
          {t("exportWizard.viewPr")}
        </a>
      ) : (
        <Button kind="primary" loading={isPending} disabled={isPending} onClick={onInstall}>
          {isPending ? t("exportWizard.installing") : t("exportWizard.install")}
        </Button>
      )}
    </div>
  );
}
