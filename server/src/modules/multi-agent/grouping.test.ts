import { describe, it, expect } from 'vitest';
import type { AgentColumn, AgentColumnFinding } from '@devdigest/shared';
import { buildConflicts } from './grouping.js';

/**
 * `buildConflicts` is the one piece of this feature with a provable contract —
 * AC-20 ("byte-for-byte identical … in any input order") and AC-24a ("recomputing
 * over the same findings in a shuffled order yields the identical line and
 * title"). These are hermetic: the function touches no db, no clock, no env.
 */

let seq = 0;
function finding(over: Partial<AgentColumnFinding> = {}): AgentColumnFinding {
  seq += 1;
  return {
    id: `f-${String(seq).padStart(3, '0')}`,
    severity: 'WARNING',
    category: 'bug',
    title: `Finding ${seq}`,
    file: 'src/a.ts',
    start_line: 10,
    kind: 'finding',
    ...over,
  };
}

function column(over: Partial<AgentColumn> = {}): AgentColumn {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Alpha',
    provider: 'openai',
    model: 'gpt-4.1',
    status: 'done',
    verdict: 'comment',
    score: 80,
    summary: null,
    duration_ms: 1000,
    cost_usd: 0.01,
    findings: [],
    ...over,
  };
}

/** Deterministic shuffle (seeded LCG) so a failure is reproducible. */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('buildConflicts — exact (file, start_line) bucketing (AC-20)', () => {
  it('groups two agents flagging the same file and start_line, regardless of title/kind/severity', () => {
    const a = column({
      run_id: 'r-a',
      agent_id: 'agent-a',
      agent_name: 'Alpha',
      findings: [
        finding({ id: 'f-a', file: 'src/pay.ts', start_line: 41, severity: 'CRITICAL', title: 'Secret key' }),
      ],
    });
    const b = column({
      run_id: 'r-b',
      agent_id: 'agent-b',
      agent_name: 'Beta',
      findings: [
        finding({ id: 'f-b', file: 'src/pay.ts', start_line: 41, severity: 'SUGGESTION', title: 'Naming', kind: 'secret_leak' }),
      ],
    });

    const conflicts = buildConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.file).toBe('src/pay.ts');
    expect(conflicts[0]!.line).toBe(41);
    expect(conflicts[0]!.takes.map((t) => t.verdict)).toEqual(['CRITICAL', 'SUGGESTION']);
  });

  it('splits ADJACENT lines 41 and 42 into different groups — no range/overlap logic', () => {
    const a = column({
      run_id: 'r-a',
      agent_id: 'agent-a',
      findings: [finding({ file: 'src/pay.ts', start_line: 41 })],
    });
    const b = column({
      run_id: 'r-b',
      agent_id: 'agent-b',
      agent_name: 'Beta',
      findings: [finding({ file: 'src/pay.ts', start_line: 42 })],
    });

    const conflicts = buildConflicts([a, b]);
    expect(conflicts.map((c) => c.line)).toEqual([41, 42]);
  });

  it('splits the same line in different files', () => {
    const a = column({
      run_id: 'r-a',
      agent_id: 'agent-a',
      findings: [
        finding({ file: 'src/b.ts', start_line: 7 }),
        finding({ file: 'src/a.ts', start_line: 7 }),
      ],
    });
    const conflicts = buildConflicts([a]);
    expect(conflicts.map((c) => c.file)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('buildConflicts — takes over done agents only (AC-21, AC-24)', () => {
  const flagged = () =>
    column({
      run_id: 'r-a',
      agent_id: 'agent-a',
      agent_name: 'Alpha',
      findings: [finding({ id: 'f-hit', file: 'src/pay.ts', start_line: 41, title: 'Hardcoded key' })],
    });

  it('a done agent with no finding in the bucket reads "ignored", with an empty note', () => {
    const silent = column({ run_id: 'r-b', agent_id: 'agent-b', agent_name: 'Beta', findings: [] });
    const [group] = buildConflicts([flagged(), silent]);
    expect(group!.takes).toEqual([
      { agent_id: 'agent-a', persona: 'Alpha', verdict: 'WARNING', note: 'Hardcoded key' },
      { agent_id: 'agent-b', persona: 'Beta', verdict: 'ignored', note: '' },
    ]);
  });

  it.each(['running', 'failed', 'cancelled'] as const)(
    'a %s agent contributes NO take at all — never "did not flag"',
    (status) => {
      const pending = column({ run_id: 'r-b', agent_id: 'agent-b', agent_name: 'Beta', status, findings: [] });
      const [group] = buildConflicts([flagged(), pending]);
      expect(group!.takes.map((t) => t.agent_id)).toEqual(['agent-a']);
    },
  );

  it('a non-done agent\'s findings do NOT create a bucket (§4 Q10)', () => {
    const failedWithFindings = column({
      run_id: 'r-b',
      agent_id: 'agent-b',
      status: 'failed',
      findings: [finding({ file: 'src/ghost.ts', start_line: 3 })],
    });
    const conflicts = buildConflicts([flagged(), failedWithFindings]);
    expect(conflicts.map((c) => c.file)).toEqual(['src/pay.ts']);
  });

  it('recomputes as agents complete: the same running agent becomes a take once done', () => {
    const b = column({ run_id: 'r-b', agent_id: 'agent-b', agent_name: 'Beta', status: 'running', findings: [] });
    const midRun = buildConflicts([flagged(), b]);
    expect(midRun[0]!.takes).toHaveLength(1);

    const afterRun = buildConflicts([flagged(), { ...b, status: 'done' }]);
    expect(afterRun[0]!.takes).toHaveLength(2);
    expect(afterRun[0]!.takes[1]!.verdict).toBe('ignored');
  });

  it('returns no groups when no agent has completed', () => {
    expect(buildConflicts([column({ status: 'running', findings: [finding()] })])).toEqual([]);
    expect(buildConflicts([])).toEqual([]);
  });
});

describe('buildConflicts — determinism (AC-20, AC-24a)', () => {
  const columns: AgentColumn[] = [
    column({
      run_id: 'r-a',
      agent_id: 'agent-a',
      agent_name: 'Alpha',
      findings: [
        finding({ id: 'f-200', file: 'src/pay.ts', start_line: 41, severity: 'WARNING', title: 'W title' }),
        finding({ id: 'f-300', file: 'src/aaa.ts', start_line: 9, severity: 'SUGGESTION', title: 'S title' }),
      ],
    }),
    column({
      run_id: 'r-b',
      agent_id: 'agent-b',
      agent_name: 'Beta',
      findings: [
        finding({ id: 'f-100', file: 'src/pay.ts', start_line: 41, severity: 'CRITICAL', title: 'C title' }),
      ],
    }),
    column({
      run_id: 'r-c',
      agent_id: 'agent-c',
      agent_name: 'Gamma',
      findings: [
        finding({ id: 'f-050', file: 'src/pay.ts', start_line: 41, severity: 'CRITICAL', title: 'Earlier id, same severity' }),
      ],
    }),
  ];

  it('shuffling the columns AND their findings yields a deeply equal result', () => {
    const expected = buildConflicts(columns);
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const shuffled = shuffle(columns, seed).map((c) => ({
        ...c,
        findings: shuffle(c.findings, seed + 1),
      }));
      expect(buildConflicts(shuffled)).toEqual(expected);
    }
  });

  it('title is the member finding first by severity, then by finding id ascending', () => {
    // Groups are (file, line)-ordered, so src/pay.ts:41 is the second one.
    const group = buildConflicts(columns)[1]!;
    // Two CRITICALs in the bucket (f-050, f-100) → the lower id wins.
    expect(group.title).toBe('Earlier id, same severity');
    expect(group.line).toBe(41);
  });

  it('groups are ordered by (file, line) and takes by (agent_id, run_id)', () => {
    const conflicts = buildConflicts(columns);
    expect(conflicts.map((c) => [c.file, c.line])).toEqual([
      ['src/aaa.ts', 9],
      ['src/pay.ts', 41],
    ]);
    expect(conflicts[1]!.takes.map((t) => t.agent_id)).toEqual(['agent-a', 'agent-b', 'agent-c']);
  });
});

describe('buildConflicts — read-only overlay (AC-12)', () => {
  it('does not mutate the input columns and preserves per-agent finding counts', () => {
    const columns = [
      column({
        run_id: 'r-a',
        agent_id: 'agent-a',
        findings: [
          finding({ file: 'src/z.ts', start_line: 2 }),
          finding({ file: 'src/a.ts', start_line: 1 }),
        ],
      }),
      column({ run_id: 'r-b', agent_id: 'agent-b', findings: [finding({ file: 'src/a.ts', start_line: 1 })] }),
    ];
    const snapshot = structuredClone(columns);

    buildConflicts(columns);

    expect(columns).toEqual(snapshot);
    expect(columns.map((c) => c.findings.length)).toEqual([2, 1]);
  });

  it('one agent flagging the same location twice still yields exactly one take', () => {
    const twice = column({
      run_id: 'r-a',
      agent_id: 'agent-a',
      agent_name: 'Alpha',
      findings: [
        finding({ id: 'f-b2', file: 'src/a.ts', start_line: 5, severity: 'SUGGESTION', title: 'Weaker' }),
        finding({ id: 'f-a1', file: 'src/a.ts', start_line: 5, severity: 'CRITICAL', title: 'Stronger' }),
      ],
    });
    const [group] = buildConflicts([twice]);
    expect(group!.takes).toHaveLength(1);
    expect(group!.takes[0]).toEqual({
      agent_id: 'agent-a',
      persona: 'Alpha',
      verdict: 'CRITICAL',
      note: 'Stronger',
    });
  });
});
