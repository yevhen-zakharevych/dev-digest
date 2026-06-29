/* ConventionCard — one extracted rule + its on-disk evidence + accept/reject.

   Rule text is inline-editable: clicking the italic rule swaps it for a
   textarea with Save / Cancel buttons. Only the rule mutates; the evidence
   block (file path + literal snippet) is read-only — that's the grounding
   the user trusts. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, IconBtn, ProgressBar } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { card, s } from "./styles";

interface ConventionCardProps {
  candidate: ConventionCandidate;
  selected: boolean;
  onToggleSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
  onSaveRule: (rule: string) => Promise<void> | void;
  busy?: boolean;
}

export function ConventionCard({
  candidate,
  selected,
  onToggleSelect,
  onAccept,
  onReject,
  onSaveRule,
  busy,
}: ConventionCardProps) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(candidate.rule);

  // Keep the draft in sync with the latest persisted rule whenever we're not
  // actively editing (e.g. after a successful save invalidates the query).
  React.useEffect(() => {
    if (!editing) setDraft(candidate.rule);
  }, [candidate.rule, editing]);

  const status = candidate.status;
  const confidence = Math.round((candidate.confidence ?? 0) * 100);
  const confidenceColor =
    confidence >= 85 ? "#54a374" : confidence >= 70 ? "#e0a14a" : "#d97076";

  const startEditing = () => {
    if (status === "rejected") return;
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(candidate.rule);
    setEditing(false);
  };

  const commitEditing = async () => {
    const next = draft.trim();
    if (next.length === 0 || next === candidate.rule) {
      cancelEditing();
      return;
    }
    await onSaveRule(next);
    setEditing(false);
  };

  return (
    <div style={card(status)} data-status={status}>
      {/* Selection checkbox — drives the Create-skill action row. */}
      {status === "accepted" && (
        <div style={{ paddingTop: 4 }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={t("card.selectAria")}
          />
        </div>
      )}

      <div style={s.body}>
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={160}
              autoFocus
              style={s.ruleInput}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelEditing();
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void commitEditing();
                }
              }}
            />
            <div style={s.ruleEditRow}>
              <Button kind="ghost" size="sm" onClick={cancelEditing}>
                {t("card.cancelEdit")}
              </Button>
              <Button
                kind="primary"
                size="sm"
                onClick={commitEditing}
                disabled={busy || draft.trim().length === 0}
              >
                {t("card.saveRule")}
              </Button>
            </div>
          </div>
        ) : (
          <div
            style={s.rule}
            title={t("card.editRuleHint")}
            onClick={startEditing}
          >
            {candidate.rule}
          </div>
        )}

        <div style={s.evidenceBox}>
          <div style={s.evidenceHeader}>
            <span style={{ flex: 1 }}>{candidate.evidence_path}</span>
            <IconBtn
              icon="Copy"
              size={22}
              label={t("card.copyEvidence")}
              onClick={() => {
                void navigator.clipboard?.writeText(
                  `${candidate.evidence_path}\n\n${candidate.evidence_snippet}`,
                );
              }}
            />
          </div>
          <pre style={s.evidenceSnippet}>{candidate.evidence_snippet}</pre>
        </div>

        <div style={s.confRow}>
          <span style={s.confLabel}>{t("card.confidence")}</span>
          <div style={{ flex: 1 }}>
            <ProgressBar value={confidence} color={confidenceColor} />
          </div>
          <span style={s.confValue}>{confidence}%</span>
        </div>
      </div>

      <div style={s.actions}>
        <Button
          kind={status === "accepted" ? "primary" : "secondary"}
          size="sm"
          icon="Check"
          onClick={onAccept}
          disabled={busy || status === "accepted"}
        >
          {status === "accepted" ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          onClick={onReject}
          disabled={busy || status === "rejected"}
        >
          {t("card.reject")}
        </Button>
      </div>
    </div>
  );
}
