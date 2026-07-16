/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type UISeverity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

/**
 * The finding-level action vocabulary, widened by one literal for the L06
 * "Turn into eval case" control (AC-1). `"seed_eval_case"` is deliberately
 * NOT added to the shared `FindingActionKind` contract — it never reaches
 * `POST /findings/:id/action` (the endpoint `FindingActionKind` describes);
 * it is routed to `POST /eval/cases/from-finding` instead, one level up
 * (`FindingsPanel.tsx`). Widening the callback prop here, rather than the
 * vendored contract, keeps Accept/Dismiss's wire shape untouched.
 */
export type FindingCardAction = FindingActionKind | "seed_eval_case";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
  targetFindingId = null,
  targetNonce = 0,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingCardAction, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** When this matches f.id, the card force-expands, scrolls into view, and
   *  highlights (driven from a Smart-Diff severity-badge deep link — mirrors
   *  ReviewRunAccordion's targetRunId/targetNonce one level up). */
  targetFindingId?: string | null;
  targetNonce?: number;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const [highlighted, setHighlighted] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (targetFindingId && f.id === targetFindingId) {
      setExpanded(true);
      setHighlighted(true);
      // Deferred to a macrotask: within the same commit, ReviewRunAccordion's
      // own scrollIntoView (to its accordion root, see FindingsTab.tsx's
      // effectiveTargetRunId comment) fires AFTER this effect (parent effects
      // run after child effects) and would otherwise clobber this more precise
      // scroll — always landing on the accordion's default-expanded first card
      // instead of this finding.
      const timer = setTimeout(() => {
        rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFindingId, targetNonce, f.id]);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div
      ref={rootRef}
      data-finding-id={f.id}
      style={{ ...s.card(!!focused || highlighted, sevColor, muted), scrollMarginTop: 16 }}
    >
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as UISeverity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            {/* AC-2: an undecided finding (neither accepted nor dismissed)
                disables this control and names the reason — the decision IS
                the expectation (accepted -> must_find, dismissed ->
                must_not_flag); there is nothing to derive without one. */}
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={pending || !muted}
              aria-label={
                muted
                  ? t("finding.turnIntoEvalCase")
                  : `${t("finding.turnIntoEvalCase")} — ${t("finding.turnIntoEvalCaseNeedsDecision")}`
              }
              title={muted ? undefined : t("finding.turnIntoEvalCaseNeedsDecision")}
              onClick={() => onAction?.("seed_eval_case")}
            >
              {t("finding.turnIntoEvalCase")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
