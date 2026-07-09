/* BlastRadiusCard — compact PR Blast Radius card (L04, reworked from the
   earlier standalone "Blast" tab). Renders the read-only tree:
     changed_symbols -> per-symbol downstream group (callers, endpoints, crons).
   No LLM at render time: `useBlastRadius` reads the deterministic
   `GET /pulls/:id/blast` route (repo-intel index, compute-on-read).
   Degraded/partial index state comes from a SEPARATE hook (`useRepoIntelStatus`,
   keyed by repoId) and is surfaced as a badge, never as an empty screen —
   see docs/plans/L04-blast-radius.md §2. Rendered by OverviewTab in a
   two-column row next to IntentCard (NOT its own tab — see the same plan's
   correction note). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, Badge, Button, MonoLink, Avatar, Skeleton, EmptyState } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/brief";
import { useRepoIntelStatus, type RepoIntelState } from "@/lib/hooks/repo-intel";
import { githubBlobUrl, githubPrUrl } from "@/lib/github-urls";
import type { ChangedSymbol, DownstreamImpact, PrHistoryItem } from "@devdigest/shared";
import { s } from "./styles";

/** Server caps callers at 20 per symbol (D2, per-`viaSymbol` cap in the
 * mapper) — a group at exactly this size gets a "showing top 20" caption
 * instead of a real overflow count (the payload doesn't carry one). */
const MAX_VISIBLE_CALLERS = 20;

const KNOWN_DEGRADED_REASONS = new Set([
  "flag_off",
  "index_failed",
  "index_partial",
  "repo_too_large",
  "no_data",
]);

// `Button`'s built-in `active` styling only applies to kind="tertiary"
// (client/INSIGHTS.md:31) — these are ghost segmented toggles, so give the
// selected one an explicit filled look, mirroring DiffTab's Smart/Original
// order toggle (`DiffTab.tsx`'s `TOGGLE_ACTIVE_STYLE`).
const TOGGLE_ACTIVE_STYLE: React.CSSProperties = {
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  borderColor: "var(--border-strong)",
  fontWeight: 600,
};

export interface BlastRadiusCardProps {
  prId: string | number;
  repoId: string | null | undefined;
  repoFullName: string | null;
  sha: string;
}

type Translator = ReturnType<typeof useTranslations>;
type ViewMode = "tree" | "graph";

/** Looks up a human reason string for a `DegradedReason` (or the looser
 * `reason` field), falling back to the raw value for any reason next-intl
 * doesn't know about — avoids a MISSING_MESSAGE throw for an unmapped enum
 * value the server might add later. */
function reasonLabel(t: Translator, reason: string | undefined | null): string | null {
  if (!reason) return null;
  return KNOWN_DEGRADED_REASONS.has(reason) ? t(`badge.reason.${reason}`) : reason;
}

function DegradedBadge({ state, t }: { state: RepoIntelState | undefined; t: Translator }) {
  if (!state) return null;

  if (state.status === "degraded" || state.status === "failed") {
    const reason = reasonLabel(t, state.degradedReason ?? state.reason);
    return (
      <div style={s.badgeRow}>
        <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--accent-bg)">
          {state.status === "failed" ? t("badge.failed") : t("badge.degraded")}
        </Badge>
        {reason && <span style={s.badgeReason}>{reason}</span>}
      </div>
    );
  }

  if (state.status === "partial") {
    const reason = reasonLabel(t, state.degradedReason ?? state.reason);
    return (
      <div style={s.badgeRow}>
        <Badge icon="Info" color="var(--text-secondary)" bg="var(--bg-hover)">
          {t("badge.partial")}
        </Badge>
        {reason && <span style={s.badgeReason}>{reason}</span>}
      </div>
    );
  }

  return null;
}

/** One changed symbol as a collapsible row: summary (chevron + name + caller
 * count) and, expanded, a compact caller list followed by endpoint/cron
 * badges stacked directly underneath (NOT separate labeled subsections —
 * that was the old tab's layout; the compact card design stacks them). */
function SymbolRow({
  symbol,
  downstream,
  repoFullName,
  sha,
  t,
  defaultOpen,
}: {
  symbol: ChangedSymbol;
  downstream: DownstreamImpact | null;
  repoFullName: string | null;
  sha: string;
  t: Translator;
  defaultOpen: boolean;
}) {
  const callers = downstream?.callers ?? [];
  const endpoints = downstream?.endpoints_affected ?? [];
  const crons = downstream?.crons_affected ?? [];

  return (
    <details style={s.symbolRow} open={defaultOpen}>
      <summary style={s.symbolSummary}>
        <Icon.ChevronRight size={13} style={s.chevron} />
        <Icon.Code size={13} style={s.symbolIcon} />
        <span className="mono" style={s.symbolName}>
          {symbol.name}
        </span>
        <span style={s.callerCount}>{t("callerCount", { count: callers.length })}</span>
      </summary>

      <div style={s.symbolBody}>
        {callers.length === 0 ? (
          <p style={s.emptyNote}>{t("noCallers")}</p>
        ) : (
          <ul style={s.callerList}>
            {callers.map((c) => (
              <li key={`${c.file}:${c.line}:${c.name}`} style={s.callerRow} title={c.name}>
                <Icon.CornerDownRight size={12} style={s.callerIcon} />
                <MonoLink
                  href={
                    repoFullName ? githubBlobUrl(repoFullName, sha, c.file, c.line, c.line) : undefined
                  }
                >
                  {c.file}:{c.line}
                </MonoLink>
              </li>
            ))}
          </ul>
        )}
        {callers.length >= MAX_VISIBLE_CALLERS && <p style={s.overflowCaption}>{t("showingTop")}</p>}

        {(endpoints.length > 0 || crons.length > 0) && (
          <div style={s.badgeWrap}>
            {endpoints.map((e) => (
              <Badge key={`endpoint:${e}`} icon="Globe" color="var(--info)" bg="var(--info-bg)" mono>
                {e}
              </Badge>
            ))}
            {crons.map((c) => (
              <Badge key={`cron:${c}`} icon="Clock" color="var(--warn)" bg="var(--warn-bg)" mono>
                {c}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

/** One row for a prior PR that previously touched at least one of the current
 * PR's changed files, rendered timeline-style (dot + connecting rail, see
 * `s.priorPrList`'s `borderLeft`). The `#{pr_number}` link and the title are
 * deliberately SEPARATE elements (not one combined string) so each is
 * independently queryable — only the caption's author+date combo needs the
 * single-text-node template-string treatment (the "getNodeText only matches
 * direct text-node children" landmine, client/INSIGHTS.md 2026-07-07). */
function PriorPrRow({ pr, repoFullName }: { pr: PrHistoryItem; repoFullName: string | null }) {
  const date = pr.merged_at ? pr.merged_at.slice(0, 10) : "";

  return (
    <li style={s.priorPrRow}>
      <span style={s.priorPrDot} />
      <div style={s.priorPrContent}>
        <div style={s.priorPrHeader}>
          <MonoLink href={repoFullName ? githubPrUrl(repoFullName, pr.pr_number) : undefined}>
            {`#${pr.pr_number}`}
          </MonoLink>
          <span style={s.priorPrTitleText}>{pr.title}</span>
        </div>
        <div style={s.priorPrMeta}>
          <Avatar name={pr.author} size={16} />
          <span style={s.priorPrCaption}>{date ? `${pr.author} · ${date}` : pr.author}</span>
        </div>
        {pr.notes && <p style={s.priorPrNotes}>{pr.notes}</p>}
      </div>
    </li>
  );
}

export function BlastRadiusCard({ prId, repoId, repoFullName, sha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const { data: blast, isLoading } = useBlastRadius(prId);
  const { data: intelState } = useRepoIntelStatus(repoId);
  const [view, setView] = React.useState<ViewMode>("tree");
  const [priorPrsOpen, setPriorPrsOpen] = React.useState(false);

  const downstreamBySymbol = React.useMemo(() => {
    const map = new Map<string, DownstreamImpact>();
    for (const d of blast?.downstream ?? []) map.set(d.symbol, d);
    return map;
  }, [blast]);

  // Stats row counts (plan §"Stats row"): symbols from `changed_symbols`,
  // callers/endpoints/crons aggregated across every downstream group —
  // endpoints/crons de-duplicated (the same endpoint can be reached via
  // multiple callers/symbols), callers summed as raw entries (not deduped).
  const stats = React.useMemo(() => {
    const symbols = blast?.changed_symbols.length ?? 0;
    let callers = 0;
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const d of blast?.downstream ?? []) {
      callers += d.callers.length;
      for (const e of d.endpoints_affected) endpoints.add(e);
      for (const c of d.crons_affected) crons.add(c);
    }
    return { symbols, callers, endpoints: endpoints.size, crons: crons.size };
  }, [blast]);

  if (isLoading) {
    return (
      <section style={s.wrap}>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <Skeleton height={16} width={220} />
        <Skeleton height={80} />
      </section>
    );
  }

  if (!blast) return null;

  return (
    <section style={s.wrap}>
      <SectionLabel icon="Workflow" right={<DegradedBadge state={intelState} t={t} />}>
        {t("title")}
      </SectionLabel>

      <div style={s.statsRow} data-testid="blast-stats-row">
        <span style={s.statsGroup}>
          {/* Each stat is rendered as a SINGLE text-node child (not split
           * "{n}"/"{label}" expressions) so `getNodeText`'s direct-text-node
           * concatenation (dom-testing-library) yields one matchable string
           * per stat, e.g. "1 symbols" — see BlastRadiusCard.test.tsx. */}
          <span className="mono tnum" style={s.statItem}>
            <Icon.Code size={12} style={s.statIcon} />
            {`${stats.symbols} ${t("stat.symbols")}`}
          </span>
          <span style={s.statSep}>·</span>
          <span className="mono tnum" style={s.statItem}>
            <Icon.CornerDownRight size={12} style={s.statIcon} />
            {`${stats.callers} ${t("stat.callers")}`}
          </span>
          <span style={s.statSep}>·</span>
          <span className="mono tnum" style={s.statItem}>
            <Icon.Globe size={12} style={s.statIcon} />
            {`${stats.endpoints} ${t("stat.endpoints")}`}
          </span>
          <span style={s.statSep}>·</span>
          <span className="mono tnum" style={s.statItem}>
            <Icon.Clock size={12} style={s.statIcon} />
            {`${stats.crons} ${t("stat.crons")}`}
          </span>
        </span>

        <div style={s.viewToggle}>
          <Button
            kind="ghost"
            size="sm"
            active={view === "tree"}
            style={view === "tree" ? TOGGLE_ACTIVE_STYLE : undefined}
            onClick={() => setView("tree")}
          >
            {t("view.tree")}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            active={view === "graph"}
            style={view === "graph" ? TOGGLE_ACTIVE_STYLE : undefined}
            onClick={() => setView("graph")}
          >
            {t("view.graph")}
          </Button>
        </div>
      </div>

      {view === "graph" ? (
        <div style={s.graphPlaceholder} aria-label={t("graph.ariaLabel")}>
          <EmptyState icon="Workflow" title={t("graph.empty")} />
        </div>
      ) : blast.changed_symbols.length === 0 ? (
        <EmptyState icon="Workflow" title={t("noDownstream", { count: 0 })} />
      ) : (
        <div style={s.symbolList}>
          {blast.changed_symbols.map((sym, i) => (
            <SymbolRow
              key={`${sym.file}:${sym.name}`}
              symbol={sym}
              downstream={downstreamBySymbol.get(sym.name) ?? null}
              repoFullName={repoFullName}
              sha={sha}
              t={t}
              defaultOpen={i === 0}
            />
          ))}
        </div>
      )}

      {blast.prior_prs.length > 0 && (
        <details
          style={s.priorPrsWrap}
          open={priorPrsOpen}
          onToggle={(e) => setPriorPrsOpen(e.currentTarget.open)}
          data-testid="blast-prior-prs"
        >
          <summary style={s.priorPrsSummary}>
            <Icon.History size={14} style={s.priorPrsIcon} />
            <span style={s.priorPrsTitle}>{t("priorPrs.title")}</span>
            <Badge mono bg="var(--bg-hover)">{blast.prior_prs.length}</Badge>
            <Icon.ChevronDown
              size={15}
              style={{ ...s.priorPrsChevron, transform: priorPrsOpen ? "rotate(180deg)" : "none" }}
            />
          </summary>
          <ul style={s.priorPrList}>
            {blast.prior_prs.map((pr) => (
              <PriorPrRow key={pr.pr_number} pr={pr} repoFullName={repoFullName} />
            ))}
          </ul>
        </details>
      )}

      <div style={s.disclaimerFooter}>
        <Icon.Info size={12} style={s.disclaimerIcon} />
        <span>
          {t("disclaimer.dynamicEdges")} {t("disclaimer.endpointsBound")}
        </span>
      </div>
    </section>
  );
}
