"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, EmptyState } from "@devdigest/ui";
import type { EvalRunSummary } from "@devdigest/shared";
import { formatDateTime } from "../../../../_lib/format";
import { runLabel } from "../helpers";
import { s } from "../styles";

/**
 * Pick exactly two runs of one agent to compare (AC-24). Drafts never
 * appear here (AC-47) because `useEvalRunHistory` only ever returns rows
 * from `eval_runs` — a draft has no run-history row by construction.
 */
export function RunPicker({
  runs,
  onCompare,
}: {
  runs: EvalRunSummary[] | undefined;
  onCompare: (a: string, b: string) => void;
}) {
  const t = useTranslations("eval");
  const [selected, setSelected] = React.useState<string[]>([]);

  if (!runs || runs.length === 0) {
    return <EmptyState icon="History" title={t("dashboard.noRuns")} />;
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id]; // keep exactly two — drop the oldest pick
      return [...prev, id];
    });
  };

  return (
    <div style={s.pickerWrap}>
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("compare.selectTwo")}</div>
      {runs.map((run) => (
        <div key={run.id} style={s.pickerRow}>
          <Checkbox checked={selected.includes(run.id)} onChange={() => toggle(run.id)} />
          <Badge mono>{runLabel(run)}</Badge>
          <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1 }}>{formatDateTime(run.started_at)}</span>
          <Badge>{run.status}</Badge>
        </div>
      ))}
      <Button
        kind="primary"
        disabled={selected.length !== 2}
        onClick={() => selected.length === 2 && onCompare(selected[0]!, selected[1]!)}
      >
        {t("compare.compare")}
      </Button>
    </div>
  );
}
