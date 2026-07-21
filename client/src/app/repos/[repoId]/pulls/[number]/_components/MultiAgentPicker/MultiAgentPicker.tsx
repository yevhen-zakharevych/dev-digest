/* MultiAgentPicker — replaces RunReviewDropdown on the PR page. A compact
   trigger opens a panel listing every agent with a checkbox + per-agent time
   hint, a Clear action, a Configure-agents link, and a primary
   "Run multi-agent review (N)" button that creates a multi-run for this PR and
   navigates to its results page (AC-1, AC-2, AC-3). Never executes inline.

   Why a hand-rolled trigger+panel and not the shared `Dropdown` kit: that
   primitive calls `onClose()` on EVERY item click (`vendor/ui/kit/Dropdown.tsx:12-15`),
   so the panel would slam shut after each ticked checkbox. It is correct for
   single-action menus and unusable for a multi-select. The first version of this
   component rendered the list inline in the PR header, which at 6 agents ate the
   whole header — hence the panel. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon, formatCost } from "@devdigest/ui";
import { AgentPickList } from "@/features/multi-agent/components/AgentPickList";
import { useAgentSelection } from "@/features/multi-agent/hooks/useAgentSelection";
import { useLatestMultiRun } from "@/lib/hooks/multi-agent-runs";
import { computeEstimateSummary, formatSeconds } from "@/features/multi-agent/helpers";

export function MultiAgentPicker({
  prId,
  repoId,
  prNumber,
  warnMerged = false,
}: {
  prId: string;
  repoId: string;
  prNumber: number;
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
}) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Does this PR already have a multi-run? If so the trigger grows a sibling
  // link back to its results — without it the results route is reachable ONLY
  // by launching a run, and navigating away strands it (nothing else in the app
  // links to `/repos/:repoId/multi-agent/:number`).
  const { data: latestMultiRun } = useLatestMultiRun(prId);

  const { agents, estimates, selected, count, toggle, clear, run, isPending } = useAgentSelection({
    repoId,
    prId,
    onRan: () => {
      setOpen(false);
      router.push(`/repos/${repoId}/multi-agent/${prNumber}`);
    },
  });

  // Close on outside click / Esc. Bound only while open, so the PR page carries
  // no idle document listeners.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary = computeEstimateSummary(selected, estimates);
  const summaryText =
    summary.timeMs == null && summary.costUsd == null
      ? t("picker.summary.noHistory")
      : t("picker.summary.line", {
          time: summary.timeMs != null ? formatSeconds(summary.timeMs) : "—",
          cost: formatCost(summary.costUsd),
        }) + (summary.approximate ? ` · ${t("picker.summary.approximate")}` : "");

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8 }}>
      {latestMultiRun ? (
        <Button
          kind="ghost"
          icon="Users"
          onClick={() => router.push(`/repos/${repoId}/multi-agent/${prNumber}`)}
        >
          {t("picker.viewResults")}
        </Button>
      ) : null}
      <Button
        kind="primary"
        icon="Sparkles"
        iconRight="ChevronDown"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={warnMerged ? t("picker.mergedTooltip") : undefined}
      >
        {t("picker.trigger")}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label={t("picker.panelLabel")}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 40,
            width: 400,
            maxWidth: "min(400px, calc(100vw - 32px))",
            display: "flex",
            flexDirection: "column",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg-elevated)",
            boxShadow: "0 12px 32px rgba(0,0,0,.22)",
            overflow: "hidden",
          }}
        >
          {/* Header — label + a Clear that only appears once something is
              selected (AC-1 requires the action; the mockup keeps the footer to
              two controls, so it lives up here rather than beside Run). */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px 8px",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {t("picker.heading")}
            </span>
            {count > 0 ? (
              <Button kind="ghost" size="sm" style={{ marginLeft: "auto" }} onClick={clear}>
                {t("picker.clear")}
              </Button>
            ) : null}
          </div>

          {warnMerged ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 14px 10px",
                fontSize: 12.5,
                color: "var(--text-secondary)",
              }}
            >
              <Icon.AlertTriangle size={14} style={{ color: "var(--warn)", flexShrink: 0 }} />
              <span>{t("picker.mergedWarning")}</span>
            </div>
          ) : null}

          <div
            style={{
              padding: "10px 14px",
              borderTop: "1px solid var(--border)",
              maxHeight: 320,
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {agents.length === 0 ? (
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("picker.noAgents")}</span>
            ) : (
              <AgentPickList
                agents={agents}
                estimates={estimates}
                selectedIds={selected}
                onToggle={toggle}
                hintMode="time"
                noHistoryLabel={t("picker.noHistory")}
              />
            )}
          </div>

          {count > 0 ? (
            <div
              data-testid="picker-estimate-summary"
              style={{
                padding: "10px 14px",
                borderTop: "1px solid var(--border)",
                fontSize: 12.5,
                color: "var(--text-secondary)",
              }}
            >
              {summaryText}
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <Button kind="ghost" size="sm" icon="Settings" onClick={() => router.push("/agents")}>
              {t("picker.configureAgents")}
            </Button>
            <Button
              kind="primary"
              size="sm"
              style={{ marginLeft: "auto" }}
              disabled={count === 0}
              aria-disabled={count === 0}
              loading={isPending}
              onClick={run}
            >
              {t("picker.runButton", { count })}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
