/* InstallationRow — one repository this agent is installed into (AC-43).
   Status comes from the shared `CiRunStatusPill` (two consumers: this row
   and the CI Runs table) — never a second, hand-rolled pill here. A repo
   with no ingested run renders the pill's own `null` state, never a stale
   status from a previous run. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { CiRunStatusPill } from "@/features/ci/components/CiRunStatusPill";
import type { CiInstallationRow } from "./types";

/**
 * Locale-aware "N units ago" via `Intl.RelativeTimeFormat` — deliberately
 * NOT an i18n catalogue string: this is Intl-formatted data (like a date or
 * a number), not translated prose, so it needs no `ci.json` key. Returns
 * `null` for an absent/unparseable timestamp so the caller can fall back to
 * an explicit "no runs yet" state instead of printing "NaN ago".
 */
function formatRelativeTime(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const diffMs = now - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diffMs);
  if (abs < minute) return rtf.format(0, "minute");
  if (abs < hour) return rtf.format(Math.round(-diffMs / minute), "minute");
  if (abs < day) return rtf.format(Math.round(-diffMs / hour), "hour");
  return rtf.format(Math.round(-diffMs / day), "day");
}

export function InstallationRow({
  row,
  onUpdateConfig,
  updating,
}: {
  row: CiInstallationRow;
  onUpdateConfig: () => void;
  updating: boolean;
}) {
  const t = useTranslations("ci");
  const relativeTime = row.last_run ? formatRelativeTime(row.last_run.ran_at) : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-surface)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>
            {row.repo}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t(`exportWizard.targets.${row.target_type}`)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
          <CiRunStatusPill status={row.last_run?.status} />
          {/* No fallback here on purpose: with no ingested run the pill ALREADY reads
              "no runs yet", and echoing the same sentence beside it says nothing twice.
              This slot carries recency only, so it is simply absent until there is a run
              to be recent about. */}
          {relativeTime && <span>{relativeTime}</span>}
        </div>
      </div>
      <Button kind="secondary" size="sm" icon="RefreshCw" loading={updating} onClick={onUpdateConfig}>
        {updating ? t("ciTab.updating") : t("ciTab.updateConfig")}
      </Button>
    </div>
  );
}
