/**
 * Pure mapping functions for the MCP transport. No DB, no `this`, no env, no
 * `@modelcontextprotocol/sdk` import — plain-object-in/out only.
 *
 * Unlike the old in-`server/` version, findings always arrive here already in
 * the canonical snake_case `Finding` shape (the HTTP API returns DTOs), so the
 * `FindingRow`/`normalize` camelCase branch is gone — the input is just
 * `Finding`.
 */
import type { Finding, Severity } from '@devdigest/shared';
import type { ConciseFinding, DetailedFinding } from './schemas.js';

export function toConciseFinding(f: Finding): ConciseFinding {
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

export function toDetailedFinding(f: Finding): DetailedFinding {
  return {
    ...toConciseFinding(f),
    rationale: f.rationale,
    suggestion: f.suggestion ?? null,
    confidence: f.confidence,
  };
}

/** Format-toggle convenience wrapper used by `get_findings`. */
export function toFinding(
  f: Finding,
  format: 'concise' | 'detailed',
): ConciseFinding | DetailedFinding {
  return format === 'detailed' ? toDetailedFinding(f) : toConciseFinding(f);
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
