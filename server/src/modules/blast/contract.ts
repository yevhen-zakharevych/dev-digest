/**
 * Blast Radius (L04) — pure `BlastResult` → `BlastRadius` wire-contract
 * mapping. No DB, no `this`, no env, no Fastify/MCP imports — plain-object-in/
 * out only, so BOTH the HTTP route (`modules/blast/routes.ts`) and the MCP
 * tool (`mcp/tools/get-blast-radius.ts`) share the exact same behavior
 * (docs/plans/L04-blast-radius.md D4). Originally lived in `mcp/mappers.ts`;
 * relocated here (a neutral leaf) so the HTTP route doesn't have to import
 * from the `mcp/` transport layer — `mcp/mappers.ts` re-exports both
 * functions unchanged so existing MCP imports/tests keep working.
 */
import type { BlastRadius, ChangedSymbol, DownstreamImpact } from '@devdigest/shared';
import type { BlastResult } from '../repo-intel/types.js';
import { MAX_CALLERS_PER_SYMBOL } from '../repo-intel/constants.js';

/** A valid, empty `BlastRadius` — used by the MCP stub / degraded callers. */
export function emptyBlastRadius(summary: string): BlastRadius {
  return {
    changed_symbols: [],
    downstream: [],
    summary,
    prior_prs: [],
  };
}

/**
 * Maps `BlastResult` (repo-intel's internal, camelCase shape) to the
 * `BlastRadius` wire contract: `changedSymbols` map 1:1 to `changed_symbols`;
 * `callers[]` are grouped by `viaSymbol` into `downstream[]` entries.
 *
 * Per-symbol caller cap (docs/plans/L04-blast-radius.md §5, D2): each group's
 * `callers` array is capped at `MAX_CALLERS_PER_SYMBOL` (20). `result.callers`
 * arrives already rank-sorted DESC (the facade's global sort in
 * `tryPersistentBlast`, `repo-intel/service.ts`) — filtering a sorted array by
 * `viaSymbol` preserves that order, so taking the first N callers encountered
 * per group keeps the highest-rank callers. Endpoint/cron attribution below
 * deliberately uses EVERY caller's file (not just the capped/displayed ones)
 * so the display cap never hides a reachable endpoint.
 *
 * When `factsByFile` is present (the non-degraded path), each group's
 * `endpoints_affected`/`crons_affected` are the union of facts for the files
 * its callers live in (per the port's own doc comment,
 * `repo-intel/types.ts:76`: "consumers can attribute endpoints/crons to the
 * changed symbol whose callers live in that file"). When `factsByFile` is
 * absent (degraded/ripgrep path), there is no per-symbol attribution
 * available, so the flat `impactedEndpoints` list is surfaced on every group
 * rather than silently dropped.
 *
 * `prior_prs` is always emitted `[]` here — this mapper is pure/DB-free and
 * PR history isn't derivable from `BlastResult`. `BlastService.getBlastRadius`
 * overwrites it with the real DB-sourced array (docs/plans/L04-blast-radius-prior-prs.md §4.4).
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
    // Cap the DISPLAYED callers per group; still track every caller's file
    // (below) for endpoint/cron attribution.
    if (group.callers.length < MAX_CALLERS_PER_SYMBOL) {
      group.callers.push({ name: caller.symbol, file: caller.file, line: caller.line });
    }
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
    prior_prs: [],
  };
}
