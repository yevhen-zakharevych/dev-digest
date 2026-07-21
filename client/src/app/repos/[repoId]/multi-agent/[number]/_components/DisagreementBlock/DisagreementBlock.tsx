/* DisagreementBlock — "Where agents disagree" (AC-21 … AC-24).

   Renders the server-computed `conflicts[]` AS-IS: no grouping, no
   re-bucketing, no re-sorting happens here. The only client-side derivation is
   the conflicts-only predicate (AC-22), which lives in `helpers.ts` because the
   `Conflict` contract carries no `is_conflict` flag and must not be widened.

   Because the takes arrive recomputed on every poll tick, the block updates
   itself as further agents complete (AC-24) — no manual refresh, and an agent
   that is still running is shown as pending, never as "did not flag". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, SectionLabel, SeverityBadge, Toggle, type UISeverity } from "@devdigest/ui";
import type { AgentColumn, Conflict, ConflictTake } from "@devdigest/shared";
import { filterConflicts, pendingAgents } from "./helpers";
import { s } from "./styles";

export function DisagreementBlock({
  conflicts,
  columns,
}: {
  conflicts: Conflict[];
  columns: AgentColumn[];
}) {
  const t = useTranslations("runs");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);
  const shown = React.useMemo(
    () => filterConflicts(conflicts, onlyConflicts),
    [conflicts, onlyConflicts],
  );

  /* Three different reasons produce an empty block, and only ONE of them means
     the agents actually agreed. `buildConflicts` emits a group per flagged
     `(file, line)` — singletons included — so `conflicts.length === 0` means
     nothing was flagged at all, never consensus. Claiming "they agree on every
     flagged location" when every agent FAILED (or flagged nothing) reports a
     non-result as a clean bill of health. */
  const empty =
    conflicts.length > 0
      ? // Groups exist; the conflicts-only filter hid the unanimous ones.
        { icon: "Check" as const, title: t("conflicts.empty") }
      : columns.some((c) => c.status === "done")
        ? { icon: "Check" as const, title: t("conflicts.emptyNoFindings") }
        : { icon: "AlertTriangle" as const, title: t("conflicts.emptyNoCompleted") };

  return (
    <section data-testid="disagreement-block">
      <SectionLabel
        icon="Users"
        right={
          // `<label>` wrapping the switch keeps the control click- AND
          // keyboard-operable while naming it visibly (AC-22).
          <label style={s.toggleLabel}>
            <span style={s.toggleText}>{t("conflicts.onlyConflicts")}</span>
            <Toggle on={onlyConflicts} onChange={setOnlyConflicts} size={16} />
          </label>
        }
      >
        {t("conflicts.title")}
      </SectionLabel>

      {shown.length === 0 ? (
        // AC-23: never a blank area — an explicit, labelled empty state.
        <div data-testid="conflicts-empty">
          <EmptyState icon={empty.icon} title={empty.title} />
        </div>
      ) : (
        <div style={s.groups}>
          {shown.map((conflict) => (
            <ConflictGroup
              key={`${conflict.file}:${conflict.line}`}
              conflict={conflict}
              columns={columns}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ConflictGroup({ conflict, columns }: { conflict: Conflict; columns: AgentColumn[] }) {
  const t = useTranslations("runs");
  const pending = pendingAgents(columns, conflict.takes);

  return (
    <div style={s.group} data-testid="conflict-group">
      <div style={s.groupHeader}>
        <span className="mono" style={s.location}>
          {/* `line` is stringified on purpose: as a number ICU would group it
              ("1,041") — a line number is an identifier, not a quantity. */}
          {t("conflicts.location", { file: conflict.file, line: String(conflict.line) })}
        </span>
        {/* Model-authored title — escaped JSX text, never dangerouslySetInnerHTML. */}
        <span style={s.groupTitle}>{conflict.title}</span>
      </div>

      <ul style={s.takes}>
        {conflict.takes.map((take) => (
          <li key={take.agent_id} style={s.take} data-testid="conflict-take">
            <span style={s.persona}>{take.persona}</span>
            <TakeVerdict take={take} />
            {take.note && <span style={s.note}>{take.note}</span>}
          </li>
        ))}
        {pending.map((column) => (
          <li key={column.agent_id} style={s.take} data-testid="conflict-pending">
            <span style={s.persona}>{column.agent_name}</span>
            <span style={s.pending}>{t("conflicts.pending")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TakeVerdict({ take }: { take: ConflictTake }) {
  const t = useTranslations("runs");
  if (take.verdict === "ignored") {
    return (
      <span style={s.didNotFlag} data-testid="take-did-not-flag">
        {t("conflicts.didNotFlag")}
      </span>
    );
  }
  // `Severity` from @devdigest/shared is the 3-value contract enum (the 4-value
  // `UISeverity` adds INFO, which a finding can never carry) — the cast is the
  // house pattern for handing a contract severity to the UI badge.
  return (
    <span data-testid="take-severity">
      <SeverityBadge severity={take.verdict as UISeverity} />
    </span>
  );
}
