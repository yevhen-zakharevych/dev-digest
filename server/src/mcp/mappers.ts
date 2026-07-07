/**
 * Pure mapping functions for the MCP transport layer. No DB, no `this`, no
 * env, no `@modelcontextprotocol/sdk` import — plain-object-in/out only.
 *
 * `toConciseFinding`/`toDetailedFinding` accept either shape a caller may hand
 * them: the raw DB row (`FindingRow`, camelCase — e.g. from the new
 * `reviewByRunId` repository read) or the already-DTO-mapped
 * `ReviewDtoFinding` (snake_case, from `ReviewService.reviewsForPull`).
 */
import type { BlastRadius, ChangedSymbol, DownstreamImpact, Finding, Severity } from '@devdigest/shared';
import type { BlastResult } from '../modules/repo-intel/types.js';
import { findingRowToDto, type ReviewDtoFinding } from '../modules/reviews/helpers.js';
import type { FindingRow } from '../modules/reviews/repository.js';
import type { ConciseFinding, DetailedFinding } from './schemas.js';

export type FindingLike = FindingRow | ReviewDtoFinding;

function isDbFindingRow(row: FindingLike): row is FindingRow {
  return 'startLine' in row;
}

/** Normalize either input shape to the canonical (snake_case) `Finding` shape. */
function normalize(row: FindingLike): Finding {
  return isDbFindingRow(row) ? findingRowToDto(row) : row;
}

export function toConciseFinding(row: FindingLike): ConciseFinding {
  const f = normalize(row);
  return {
    id: f.id,
    severity: f.severity,
    category: f.category,
    title: f.title,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
  };
}

export function toDetailedFinding(row: FindingLike): DetailedFinding {
  const f = normalize(row);
  return {
    ...toConciseFinding(row),
    rationale: f.rationale,
    suggestion: f.suggestion ?? null,
    confidence: f.confidence,
  };
}

/** Format-toggle convenience wrapper used by `get_findings`. */
export function toFinding(
  row: FindingLike,
  format: 'concise' | 'detailed',
): ConciseFinding | DetailedFinding {
  return format === 'detailed' ? toDetailedFinding(row) : toConciseFinding(row);
}

const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

export interface PaginatedFindings<T> {
  items: T[];
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
}

/**
 * Sort by severity (CRITICAL → WARNING → SUGGESTION), slice from `offset`,
 * then stop adding items once the cumulative JSON char length would exceed
 * `maxChars` (~25k, the MCP output budget). Always includes at least one
 * item per page (even if that single item alone exceeds the budget) so a
 * page never comes back empty while `total > offset`.
 */
export function paginateFindings<T extends { severity: Severity }>(
  all: T[],
  offset: number,
  opts: { maxChars?: number } = {},
): PaginatedFindings<T> {
  const maxChars = opts.maxChars ?? 25000;
  const sorted = [...all].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const total = sorted.length;
  const slice = sorted.slice(offset);

  const items: T[] = [];
  let charBudget = 0;
  for (const item of slice) {
    const itemChars = JSON.stringify(item).length;
    if (items.length > 0 && charBudget + itemChars > maxChars) break;
    items.push(item);
    charBudget += itemChars;
  }

  const has_more = offset + items.length < total;
  return {
    items,
    total,
    count: items.length,
    offset,
    has_more,
    next_offset: has_more ? offset + items.length : null,
  };
}

/** A valid, empty `BlastRadius` — the stub result `get_blast_radius` returns today. */
export function emptyBlastRadius(summary: string): BlastRadius {
  return {
    changed_symbols: [],
    downstream: [],
    summary,
  };
}

/**
 * TODO(L04-homework): wire this in for real in `get-blast-radius.ts` —
 * resolve the PR's changed files (`ReviewRepository.getPrFiles(prId)`) →
 * `container.repoIntel.getBlastRadius(repoId, changedFiles)` (returns
 * `BlastResult`) → `blastResultToContract(result)`. Fully implemented here so
 * that swap is a one-liner.
 *
 * Maps `BlastResult` (repo-intel's internal, camelCase shape) to the
 * `BlastRadius` wire contract: `changedSymbols` map 1:1 to `changed_symbols`;
 * `callers[]` are grouped by `viaSymbol` into `downstream[]` entries. When
 * `factsByFile` is present (the non-degraded path), each group's
 * `endpoints_affected`/`crons_affected` are the union of facts for the files
 * its callers live in (per the port's own doc comment,
 * `repo-intel/types.ts:76`: "consumers can attribute endpoints/crons to the
 * changed symbol whose callers live in that file"). When `factsByFile` is
 * absent (degraded/ripgrep path), there is no per-symbol attribution
 * available, so the flat `impactedEndpoints` list is surfaced on every group
 * rather than silently dropped.
 */
export function blastResultToContract(result: BlastResult): BlastRadius {
  const changed_symbols: ChangedSymbol[] = result.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  const groups = new Map<string, DownstreamImpact>();
  const filesBySymbol = new Map<string, Set<string>>();

  for (const caller of result.callers) {
    let group = groups.get(caller.viaSymbol);
    if (!group) {
      group = { symbol: caller.viaSymbol, callers: [], endpoints_affected: [], crons_affected: [] };
      groups.set(caller.viaSymbol, group);
      filesBySymbol.set(caller.viaSymbol, new Set());
    }
    group.callers.push({ name: caller.symbol, file: caller.file, line: caller.line });
    filesBySymbol.get(caller.viaSymbol)!.add(caller.file);
  }

  if (result.factsByFile) {
    const factsByFile = result.factsByFile;
    for (const [viaSymbol, files] of filesBySymbol) {
      const group = groups.get(viaSymbol);
      if (!group) continue;
      const endpoints = new Set<string>();
      const crons = new Set<string>();
      for (const file of files) {
        const facts = factsByFile[file];
        if (!facts) continue;
        for (const e of facts.endpoints) endpoints.add(e);
        for (const c of facts.crons) crons.add(c);
      }
      group.endpoints_affected = [...endpoints];
      group.crons_affected = [...crons];
    }
  } else if (result.impactedEndpoints.length > 0) {
    for (const group of groups.values()) {
      group.endpoints_affected = [...result.impactedEndpoints];
    }
  }

  const summary = result.degraded
    ? `blast radius degraded (${result.reason ?? 'unknown reason'}) — ${changed_symbols.length} changed symbol(s) mapped without full downstream data`
    : `${changed_symbols.length} changed symbol(s) affect ${groups.size} downstream caller group(s)`;

  return {
    changed_symbols,
    downstream: [...groups.values()],
    summary,
  };
}
