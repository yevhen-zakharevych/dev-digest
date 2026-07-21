import type { AgentColumn, AgentColumnFinding, Conflict, ConflictTake, Severity } from '@devdigest/shared';

/**
 * "Where agents disagree" — the deterministic conflict grouping (AC-20, AC-21,
 * AC-24, AC-24a).
 *
 * PURE by contract: no db, no fetch, no `process.env`, no framework import, no
 * model call, and nothing imported from `reviewer-core` or `modules/eval`. It is
 * a read-time overlay over already-persisted columns — it merges no findings,
 * reassigns none to another agent, and drops none.
 *
 * The bucket key is the EXACT `(file, start_line)` pair. Deliberately NOT range
 * overlap: overlap is not transitive (10–15 ~ 14–20 ~ 19–25, but 10–15 ≁ 19–25),
 * so grouping by it is a union-find whose output depends on iteration order —
 * which is exactly what AC-20's determinism forbids. Adjacent lines (41 vs 42)
 * therefore land in different groups; that is the accepted cost.
 */

/** Severity precedence for the title/verdict pick. CRITICAL wins (contracts/findings.ts:11). */
const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/** "Did not flag" — a completed agent with no finding in the bucket. */
const IGNORED = 'ignored' as const;

/**
 * The two key parts are joined by NUL, which cannot occur in a Postgres `text`
 * value — so no file path can forge a collision the way a printable separator
 * would allow (with ":", the pairs `("a:1", 2)` and `("a", 12)` would both key
 * to "a:1:2"). The key stays an exact string pair, never a hash.
 */
const KEY_SEP = '\u0000';

interface Member {
  column: AgentColumn;
  finding: AgentColumnFinding;
}

interface Bucket {
  file: string;
  line: number;
  members: Member[];
}

/**
 * Order two findings by the AC-24a rule: severity rank first, then finding id
 * ascending. Used both for the group title and for picking one finding when a
 * single agent flagged the same location twice.
 */
function bySeverityThenId(a: AgentColumnFinding, b: AgentColumnFinding): number {
  const rank = severityRank(a.severity) - severityRank(b.severity);
  if (rank !== 0) return rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function severityRank(severity: Severity): number {
  // `?? ` guards a value that slipped past the enum upstream; an unranked
  // severity sorts last rather than making the comparator return NaN (which
  // would silently make the sort — and therefore the title — order-dependent).
  return SEVERITY_RANK[severity] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Group the findings of the multi-run's **completed** columns by `(file, start_line)`.
 *
 * - Only `done` columns form buckets and contribute takes (§4 Q10). A `running`,
 *   `failed` or `cancelled` agent has not answered, so its silence is not a
 *   "did not flag" — it contributes NO take at all (AC-24).
 * - Every `done` column gets exactly one take per group: its finding's severity,
 *   or the literal `'ignored'`. A done agent with zero findings reads `ignored`
 *   in every group.
 * - The result is byte-identical for the same input in any order: columns are
 *   ordered once by `(agent_id, run_id)`, buckets by `(file, line)`, and the
 *   title is picked by the total order above.
 */
export function buildConflicts(columns: AgentColumn[]): Conflict[] {
  const done = [...columns]
    .filter((c) => c.status === 'done')
    .sort(
      (a, b) =>
        compareStrings(a.agent_id, b.agent_id) || compareStrings(a.run_id, b.run_id),
    );
  if (done.length === 0) return [];

  const buckets = new Map<string, Bucket>();
  for (const column of done) {
    for (const finding of column.findings) {
      const key = `${finding.file}${KEY_SEP}${finding.start_line}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { file: finding.file, line: finding.start_line, members: [] };
        buckets.set(key, bucket);
      }
      bucket.members.push({ column, finding });
    }
  }

  const conflicts: Conflict[] = [];
  for (const bucket of buckets.values()) {
    // Title: the member finding first by severity, then by id (AC-24a).
    const titleSource = bucket.members
      .map((m) => m.finding)
      .sort(bySeverityThenId)[0]!;

    // One take per DONE column, emitted in the columns' fixed order so `takes[]`
    // is stable across runs. A column that flagged the location twice is
    // represented by its own strongest finding, by the same total order.
    const takes: ConflictTake[] = done.map((column) => {
      const own = bucket.members
        .filter((m) => m.column.run_id === column.run_id)
        .map((m) => m.finding)
        .sort(bySeverityThenId)[0];
      return {
        agent_id: column.agent_id,
        // §4 Q1 — the contract requires non-optional strings and the spec is
        // silent, so: persona = the column's agent name, note = the flagging
        // finding's title (empty for a "did not flag").
        persona: column.agent_name,
        verdict: own ? own.severity : IGNORED,
        note: own ? own.title : '',
      };
    });

    conflicts.push({
      file: bucket.file,
      // AC-24a — the group's key IS its rendered line.
      line: bucket.line,
      title: titleSource.title,
      takes,
    });
  }

  return conflicts.sort((a, b) => compareStrings(a.file, b.file) || a.line - b.line);
}

function compareStrings(a: string, b: string): number {
  // Code-unit order, NOT `localeCompare` — locale collation is environment
  // dependent and would make "byte-identical across computations" false on a
  // machine with a different ICU locale.
  return a < b ? -1 : a > b ? 1 : 0;
}
