import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { EvalService } from '../src/modules/eval/service.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  EvalCaseInput,
  EvalComparison,
  EvalRunDetail,
  Finding,
  FindingKind,
  LLMProvider,
  ModelInfo,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

/**
 * T20 — the acceptance demo. This is the one file in L06 that PROVES the eval
 * pipeline measures something real, by driving it end-to-end against a
 * `MockLLMProvider`-backed provider whose finding-set is a FUNCTION of the
 * prompt it receives (a marker string picked up from the assembled messages
 * selects the variant), through the real engine entry point
 * (`reviewPullRequest`), the real mandatory grounding gate, and the real
 * mechanical scorer. Nothing here is a unit test of one function — every
 * assertion is downstream of an actual `EvalService.startRun` → executor →
 * `reviewPullRequest` → `groundFindings` → `scoreCase` → `aggregateSetMetrics`
 * → `compareRuns` chain, run against a real Postgres.
 *
 * LANDMINE (`server/INSIGHTS.md:50`, root `INSIGHTS.md:17`): the grounding gate
 * SILENTLY drops a finding whose lines miss a hunk — no error, `findings: []`.
 * Every fixture finding below is placed on a line the case's own frozen diff
 * hunk actually covers (or, for the one full-file-kind case, merely on a file
 * the diff touches), or the experiment would measure nothing while reporting
 * green. This is exactly the failure that once inverted an A/B verdict in
 * this repo.
 *
 * NARRATIVE (why one `beforeAll`, not one arrange-per-`it`): the five runs
 * below are a single continuous experiment — later runs are only meaningful
 * relative to earlier ones (a version bump, a skill link, a promote). Running
 * the whole sequence once in `beforeAll` and asserting one fact per `it` is
 * the AAA pattern applied at the SUITE level: Arrange = the whole narrative;
 * each `it` is a pure Assert. Splitting the narrative into independent
 * per-`it` arranges would either re-run (and re-diverge) the experiment N
 * times or force artificial cross-`it` ordering — worse than the shared
 * `beforeAll`.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-ab-experiment] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ===========================================================================
// The prompt/skill markers that pick a finding-set variant. Each is a bare,
// unambiguous token so substring matching cannot cross-contaminate.
// ===========================================================================
const MARKER_BASELINE = 'AB_TEST_MARKER_BASELINE_V1';
const MARKER_IMPROVED = 'AB_TEST_MARKER_IMPROVED_V2';
const MARKER_CORRUPTED = 'AB_TEST_MARKER_CORRUPTED_V3';
const MARKER_SKILL_REGRESSION = 'AB_TEST_MARKER_SKILL_REGRESSION';

const PROMPT_BASELINE =
  `You are a careful code reviewer. Review the diff and report defects you can defend. ${MARKER_BASELINE}`;
const PROMPT_IMPROVED =
  `You are a meticulous senior code reviewer. Review every changed file end-to-end and report ` +
  `every defect you can defend, including subtle ones — do not stop after the obvious issue. ${MARKER_IMPROVED}`;
const PROMPT_CORRUPTED =
  `You are an overeager code reviewer. Report anything that could conceivably be an issue, even ` +
  `speculative or low-confidence noise — err on the side of flagging more. ${MARKER_CORRUPTED}`;

/** Injected via a linked skill's body (lands in the USER message, not the system one). */
const SKILL_REGRESSION_BODY =
  `Rule: when reviewing billing-related files, defer to the billing team's own review process and ` +
  `do not report findings there yourself. ${MARKER_SKILL_REGRESSION}`;

// ===========================================================================
// The 8-case set (5 must_find + 3 must_not_flag) — built locally rather than
// reusing the seed's fixtures because two of them (F5's two-hunk file) need a
// SECOND, unrelated hunk in the same file to make room for a genuinely
// non-overlapping "noise" finding — the seed's fixtures are single-hunk with
// hunk == expected-region exactly, by design, so there is no room in them to
// place noise that grounds without also overlapping the expected range.
// ===========================================================================
const F1_FILE = 'src/service/auth.ts';
const F2_FILE = 'src/service/billing.ts';
const F3_FILE = 'src/service/cache.ts';
const F4_FILE = 'src/config/keys.ts'; // full-file kind (secret_leak) — AC-17
const F5_FILE = 'src/service/payments.ts'; // two hunks: line 40 (expected) + line 45 (noise site)
const N1_FILE = 'src/utils/log.ts';
const N2_FILE = 'src/utils/format.ts';
const N3_FILE = 'src/utils/id.ts';

const F5_EXPECTED_LINE = 40;
const F5_NOISE_LINE = 45;

function oneHunkDiff(file: string, line: number): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${line},0 +${line},1 @@`,
    `+// change at line ${line}`,
  ].join('\n');
}

function twoHunkDiff(file: string, lineA: number, lineB: number): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${lineA},0 +${lineA},1 @@`,
    `+// change at line ${lineA}`,
    `@@ -${lineB},0 +${lineB},1 @@`,
    `+// change at line ${lineB}`,
  ].join('\n');
}

interface CaseFixture {
  name: string;
  file: string;
  expectation: 'must_find' | 'must_not_flag';
  line: number;
  kind: FindingKind;
  diff: string;
  notes?: string;
}

const CASE_FIXTURES: CaseFixture[] = [
  { name: 'F1 auth guard', file: F1_FILE, expectation: 'must_find', line: 12, kind: 'finding', diff: oneHunkDiff(F1_FILE, 12) },
  { name: 'F2 billing overcharge', file: F2_FILE, expectation: 'must_find', line: 22, kind: 'finding', diff: oneHunkDiff(F2_FILE, 22) },
  { name: 'F3 cache poisoning', file: F3_FILE, expectation: 'must_find', line: 33, kind: 'finding', diff: oneHunkDiff(F3_FILE, 33) },
  { name: 'F4 hardcoded secret', file: F4_FILE, expectation: 'must_find', line: 5, kind: 'secret_leak', diff: oneHunkDiff(F4_FILE, 5) },
  {
    name: 'F5 payments off-by-one',
    file: F5_FILE,
    expectation: 'must_find',
    line: F5_EXPECTED_LINE,
    kind: 'finding',
    diff: twoHunkDiff(F5_FILE, F5_EXPECTED_LINE, F5_NOISE_LINE),
  },
  {
    name: 'N1 unused import',
    file: N1_FILE,
    expectation: 'must_not_flag',
    line: 8,
    kind: 'finding',
    diff: oneHunkDiff(N1_FILE, 8),
    notes: 'Dismissed as noise — the linter already catches this.',
  },
  {
    name: 'N2 redundant guard',
    file: N2_FILE,
    expectation: 'must_not_flag',
    line: 15,
    kind: 'finding',
    diff: oneHunkDiff(N2_FILE, 15),
    notes: 'Dismissed — the guard is intentional defensive code.',
  },
  {
    name: 'N3 non-descriptive name',
    file: N3_FILE,
    expectation: 'must_not_flag',
    line: 3,
    kind: 'finding',
    diff: oneHunkDiff(N3_FILE, 3),
    notes: "Dismissed as a style nit outside the team's enforced conventions.",
  },
];

function mkFinding(id: string, file: string, line: number, kind: FindingKind, title: string): Finding {
  return {
    id,
    severity: 'WARNING',
    category: 'bug',
    title,
    file,
    start_line: line,
    end_line: line,
    rationale: 'synthetic fixture finding for the eval A/B experiment',
    confidence: 0.9,
    kind,
  };
}

/** The four variants a finding-set can be. Priority: skill-regression > corrupted > improved > baseline. */
type Variant = 'BASELINE' | 'IMPROVED' | 'CORRUPTED' | 'SKILL_REGRESSION';

/**
 * Per-variant, per-file findings. F1/F3/F4 are ALWAYS correctly found by every
 * variant (the stable control group); F2 and F5 are the two axes that move:
 *  - F5 flips BASELINE (missed) → IMPROVED (found)              — assertion (a)
 *  - CORRUPTED finds everything IMPROVED finds, PLUS unrelated noise on F5's
 *    second hunk (line 45) that matches no expected item          — assertion (b)
 *  - SKILL_REGRESSION finds everything IMPROVED finds EXCEPT F2   — assertion (d)
 * N1/N2/N3 NEVER receive a finding under any variant — this is what proves
 * assertion (b)'s precision drop comes from noise on a POSITIVE case, not
 * from a forbidden-region hit.
 */
function findingsFor(variant: Variant, file: string): Finding[] {
  switch (file) {
    case F1_FILE:
      return [mkFinding('f1', F1_FILE, 12, 'finding', 'F1 auth guard bypass')];
    case F3_FILE:
      return [mkFinding('f3', F3_FILE, 33, 'finding', 'F3 cache poisoning')];
    case F4_FILE:
      return [mkFinding('f4', F4_FILE, 5, 'secret_leak', 'F4 hardcoded secret')];
    case F2_FILE:
      // The ONE finding that SKILL_REGRESSION drops.
      return variant === 'SKILL_REGRESSION'
        ? []
        : [mkFinding('f2', F2_FILE, 22, 'finding', 'F2 billing overcharge')];
    case F5_FILE: {
      if (variant === 'BASELINE') return [];
      const hit = mkFinding('f5', F5_FILE, F5_EXPECTED_LINE, 'finding', 'F5 payments off-by-one');
      if (variant === 'CORRUPTED') {
        const noise = mkFinding('f5-noise', F5_FILE, F5_NOISE_LINE, 'finding', 'F5 speculative noise');
        return [hit, noise];
      }
      return [hit]; // IMPROVED, SKILL_REGRESSION
    }
    case N1_FILE:
    case N2_FILE:
    case N3_FILE:
      return []; // never flagged, under any variant
    default:
      return [];
  }
}

function fileFromMessages(messages: ChatMessage[]): string | null {
  const all = messages.map((m) => m.content).join('\n');
  const m = /diff --git a\/(\S+) b\//.exec(all);
  return m ? m[1]! : null;
}

function pickVariant(messages: ChatMessage[]): Variant {
  const all = messages.map((m) => m.content).join('\n');
  if (all.includes(MARKER_SKILL_REGRESSION)) return 'SKILL_REGRESSION';
  if (all.includes(MARKER_CORRUPTED)) return 'CORRUPTED';
  if (all.includes(MARKER_IMPROVED)) return 'IMPROVED';
  if (all.includes(MARKER_BASELINE)) return 'BASELINE';
  throw new Error(
    `PromptSensitiveLLM: no known marker found in the assembled prompt — the test fixture is out of sync.\n${all}`,
  );
}

/**
 * The provider that makes this a DETERMINISTIC A/B/skill experiment: its
 * returned finding-set is a pure FUNCTION of the system prompt (+ any linked
 * skill body) it receives — never randomness, never a real model call. Every
 * actual response is still produced by a real `MockLLMProvider` instance (so
 * the schema-validated, cost/token-stamped envelope is the real one) — this
 * class only decides WHICH fixture that inner provider serves, based on the
 * marker(s) present in `req.messages`.
 */
class PromptSensitiveLLM implements LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter' = 'openrouter';
  private fallback = new MockLLMProvider('openai', {});

  async listModels(): Promise<ModelInfo[]> {
    return this.fallback.listModels();
  }
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return this.fallback.complete(req);
  }
  async embed(texts: string[]): Promise<number[][]> {
    return this.fallback.embed(texts);
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const variant = pickVariant(req.messages);
    const file = fileFromMessages(req.messages);
    const findings = file ? findingsFor(variant, file) : [];
    const review = {
      verdict: findings.length > 0 ? 'request_changes' : 'approve',
      summary: `[fixture] variant=${variant} file=${file ?? 'unknown'} findings=${findings.length}`,
      score: findings.length > 0 ? 55 : 95,
      findings,
    };
    // Delegate to a REAL MockLLMProvider so the schema validation, cost
    // stamping and token accounting are the same code path every other
    // integration test relies on — this class only chooses the fixture.
    const inner = new MockLLMProvider('openai', { structured: review });
    return inner.completeStructured(req);
  }
}

async function waitForRun(
  service: EvalService,
  workspaceId: string,
  runId: string,
  timeoutMs = 15_000,
): Promise<EvalRunDetail> {
  const start = Date.now();
  for (;;) {
    const run = await service.getRun(workspaceId, runId);
    if (run.status !== 'running') return run;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`eval run ${runId} did not reach a terminal status within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

d('T20 — the A/B experiment (acceptance demo)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let service: EvalService;
  let agentsRepo: AgentsRepository;
  let agentId: string;

  // The narrative's results, computed once in beforeAll (see the module doc).
  let R1: EvalRunDetail; // BASELINE — misses F5
  let R2: EvalRunDetail; // IMPROVED — finds F5 too
  let R2b: EvalRunDetail; // IMPROVED again, unchanged agent — the noise floor
  let R3: EvalRunDetail; // CORRUPTED — finds everything R2 finds, PLUS noise
  let R4: EvalRunDetail; // IMPROVED, no skill — the skill-test baseline
  let R5: EvalRunDetail; // IMPROVED + a regression skill linked
  let skillId: string;
  let versionAtR4: number;

  let cmpR1R2: EvalComparison;
  let cmpR2R2b: EvalComparison;
  let cmpR2R3: EvalComparison;
  let cmpR4R5: EvalComparison;

  beforeAll(async () => {
    pg = await startPg();
    const [ws] = await pg.handle.db.insert(t.workspaces).values({ name: 'ab-experiment-ws' }).returning();
    workspaceId = ws!.id;

    const container = new Container(config(), pg.handle.db, {
      // Registered under 'openrouter' — the agent's provider — per the
      // documented landmine (`server/INSIGHTS.md:64`): MockLLMProvider (and
      // any hand-rolled LLMProvider) can be REGISTERED under any provider id
      // regardless of what it was constructed with.
      llm: { openrouter: new PromptSensitiveLLM() },
    });
    service = new EvalService(container);
    agentsRepo = container.agentsRepo;

    const agent = await agentsRepo.insert({
      workspaceId,
      name: 'A/B experiment agent',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      systemPrompt: PROMPT_BASELINE,
    });
    agentId = agent.id;

    // ---- seed the 8-case set (5 must_find + 3 must_not_flag) ----
    for (const fx of CASE_FIXTURES) {
      const input: EvalCaseInput = {
        owner_kind: 'agent',
        owner_id: agentId,
        name: fx.name,
        expectation: fx.expectation,
        input_diff: fx.diff,
        input_meta: { title: `Fixture: ${fx.name}` },
        expected_output:
          fx.expectation === 'must_find'
            ? [{ file: fx.file, start_line: fx.line, end_line: fx.line, kind: fx.kind }]
            : [],
        forbidden_region:
          fx.expectation === 'must_not_flag'
            ? { file: fx.file, start_line: fx.line, end_line: fx.line, kind: fx.kind }
            : null,
        notes: fx.notes ?? null,
      };
      await service.createCase(workspaceId, input);
    }

    const run = async (): Promise<EvalRunDetail> => {
      const started = await service.startRun(workspaceId, agentId);
      return waitForRun(service, workspaceId, started.id);
    };

    // ---- (a) BASELINE → IMPROVED: the metrics move ----
    R1 = await run(); // prompt is still PROMPT_BASELINE (set at agent creation)
    await agentsRepo.update(workspaceId, agentId, { systemPrompt: PROMPT_IMPROVED });
    R2 = await run();
    cmpR1R2 = await service.compare(workspaceId, R1.id, R2.id);

    // ---- (c) two runs of the UNCHANGED agent — the noise floor ----
    R2b = await run(); // prompt still PROMPT_IMPROVED — nothing changed
    cmpR2R2b = await service.compare(workspaceId, R2.id, R2b.id);

    // ---- (b) deliberately corrupt the prompt: precision drops ----
    await agentsRepo.update(workspaceId, agentId, { systemPrompt: PROMPT_CORRUPTED });
    R3 = await run();
    cmpR2R3 = await service.compare(workspaceId, R2.id, R3.id);

    // ---- (d)/(e) link a skill: same version tag, different effective config ----
    await agentsRepo.update(workspaceId, agentId, { systemPrompt: PROMPT_IMPROVED });
    R4 = await run(); // clean baseline for the skill test, no skill linked
    versionAtR4 = (await agentsRepo.getById(workspaceId, agentId))!.version;

    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'Billing deference (regression)',
        description: 'Synthetic skill that induces a recall regression for the A/B experiment.',
        type: 'rubric',
        source: 'manual',
        body: SKILL_REGRESSION_BODY,
        version: 1,
      })
      .returning();
    skillId = skill!.id;
    await agentsRepo.setSkills(agentId, [skillId]);

    R5 = await run();
    cmpR4R5 = await service.compare(workspaceId, R4.id, R5.id);
  }, 60_000);

  afterAll(async () => {
    await pg?.stop();
  });

  // =========================================================================
  // (a) old prompt → new prompt: the metrics MOVE, and the flip is NAMED
  //     (AC-24, AC-26)
  // =========================================================================
  it('(a) BASELINE → IMPROVED moves recall and names exactly the case that flipped', () => {
    // Before: 4/5 expected items matched (F5 missed) → recall 0.8.
    expect(R1.recall).toBeCloseTo(0.8, 6);
    expect(R1.precision).toBe(1); // no noise emitted anywhere at BASELINE
    // After: F5 is now found too → recall 1.0.
    expect(R2.recall).toBe(1);
    expect(R2.precision).toBe(1);

    expect(cmpR1R2.comparable).toBe(true);
    expect(cmpR1R2.shared_case_count).toBe(8); // the case set never changed
    expect(cmpR1R2.excluded_cases).toEqual([]);
    expect(cmpR1R2.delta.recall).toBeCloseTo(0.2, 6); // a REAL, non-zero delta
    expect(cmpR1R2.delta.precision).toBe(0);

    // The delta is never presented alone (AC-38): exactly ONE case flipped,
    // and it is NAMED — a 20-point recall delta on an 8-case set is legible
    // as "one case", not as a trend.
    expect(cmpR1R2.flipped_cases).toHaveLength(1);
    expect(cmpR1R2.flipped_cases[0]).toMatchObject({
      case_name: 'F5 payments off-by-one',
      direction: 'now_passing',
    });
  });

  // =========================================================================
  // (c) two runs of the UNCHANGED agent are comparable and their prompt diff
  //     is empty — the noise floor (AC-25)
  // =========================================================================
  it('(c) two runs of an unchanged agent are comparable, with an empty prompt diff and a zero delta', () => {
    expect(cmpR2R2b.comparable).toBe(true);
    expect(cmpR2R2b.base.agent_version).toBe(cmpR2R2b.candidate.agent_version);
    expect(cmpR2R2b.base_config).not.toBeNull();
    expect(cmpR2R2b.base_config!.system_prompt).toBe(cmpR2R2b.candidate_config!.system_prompt);
    // Deterministic mock ⇒ the noise floor here is exactly zero — still a
    // valid demonstration that "same config, non-zero delta would be noise,
    // not a regression" (AC-25/AC-38): there is nothing here to misattribute.
    expect(cmpR2R2b.delta).toEqual({ recall: 0, precision: 0, citation_accuracy: 0 });
    expect(cmpR2R2b.flipped_cases).toEqual([]);
  });

  // =========================================================================
  // (b) a deliberately CORRUPTED prompt ⇒ precision drops, from noise
  //     emitted on a POSITIVE case — never inside a forbidden region
  //     (AC-19, AC-22)
  // =========================================================================
  it('(b) a corrupted prompt drops set-level precision via noise on a must_find case, not a forbidden region', () => {
    // Recall is UNCHANGED — the corrupted variant still finds everything the
    // improved one finds. Only precision moves.
    expect(R3.recall).toBe(1);
    // 6 surviving findings total (F1..F4 + F5-hit + F5-noise), 5 of which match ⇒ 5/6.
    expect(R3.precision).toBeCloseTo(5 / 6, 6);
    expect(R3.precision).toBeLessThan(R2.precision!);

    expect(cmpR2R3.comparable).toBe(true);
    expect(cmpR2R3.delta.recall).toBe(0);
    expect(cmpR2R3.delta.precision).toBeCloseTo(5 / 6 - 1, 6);
    expect(cmpR2R3.delta.precision!).toBeLessThan(0);

    // THE point of this assertion: the noise sat on a `must_find` case (F5),
    // which still PASSES per-case (AC-22 — an extra finding never fails a
    // positive case) — so NO case flips, yet precision still fell. A
    // per-case-only (or negative-case-only) definition would have divided by
    // zero here and never moved at all.
    expect(cmpR2R3.flipped_cases).toEqual([]);
    const f5Result = R3.results.find((r) => r.case_name === 'F5 payments off-by-one')!;
    expect(f5Result.outcome).toBe('passed');
    expect(f5Result.kept_count).toBe(2); // the real hit + the noise
    expect(f5Result.unmatched_finding_ids).toHaveLength(1);

    // And explicitly: no must_not_flag case received ANY finding — the drop
    // is provably NOT a forbidden-region hit.
    for (const name of ['N1 unused import', 'N2 redundant guard', 'N3 non-descriptive name']) {
      const r = R3.results.find((x) => x.case_name === name)!;
      expect(r.outcome).toBe('passed');
      expect(r.kept_count).toBe(0);
    }
  });

  // =========================================================================
  // (d) linking a skill ⇒ same version tag, different effective config, and
  //     the comparison SAYS SO and names the skill delta (AC-51, AC-10)
  // =========================================================================
  it('(d) a linked skill produces the same version tag but a different effective config, and the comparison names it', async () => {
    // setSkills bumps NO version — verified directly against the landmine at
    // `server/src/modules/agents/repository.ts:266-281` this spec calls out.
    const afterLink = await agentsRepo.getById(workspaceId, agentId);
    expect(afterLink!.version).toBe(versionAtR4);

    expect(cmpR4R5.base.agent_version).toBe(cmpR4R5.candidate.agent_version); // SAME tag
    expect(cmpR4R5.base_config!.system_prompt).toBe(cmpR4R5.candidate_config!.system_prompt); // EMPTY prompt diff
    // …yet the comparison refuses to call this "model noise":
    expect(cmpR4R5.effective_config_divergence).toBe(true);
    expect(cmpR4R5.skill_delta).toEqual([
      { skill_id: skillId, name: 'Billing deference (regression)', change: 'added', from_version: null, to_version: 1 },
    ]);

    // AND it is a REAL regression, not a phantom one: F2 stopped being found.
    expect(R4.recall).toBe(1);
    expect(R5.recall).toBeCloseTo(0.8, 6);
    expect(cmpR4R5.delta.recall).toBeCloseTo(-0.2, 6);
    expect(cmpR4R5.flipped_cases).toEqual([
      expect.objectContaining({ case_name: 'F2 billing overcharge', direction: 'now_failing' }),
    ]);
  });

  // =========================================================================
  // AC-10 — the pin is BY VALUE and IMMUTABLE: later prompt/skill edits never
  // rewrite an already-finished run's stored snapshot.
  // =========================================================================
  it('AC-10: a run’s pinned effective config never changes after the fact, even as the live agent keeps moving', () => {
    // R1 was pinned while the agent's live prompt was PROMPT_BASELINE. The
    // live agent has since been edited three more times (IMPROVED, CORRUPTED,
    // IMPROVED again) and had a skill linked — none of that may leak into R1.
    expect(R1.effective_config.system_prompt).toBe(PROMPT_BASELINE);
    expect(R2.effective_config.system_prompt).toBe(PROMPT_IMPROVED);
    expect(R3.effective_config.system_prompt).toBe(PROMPT_CORRUPTED);
    // R4 was pinned BEFORE the skill was linked — its snapshot must still show no skills.
    expect(R4.effective_config.skills).toEqual([]);
    expect(R5.effective_config.skills.map((s) => s.id)).toEqual([skillId]);
    expect(R5.effective_config.skills[0]!.version).toBe(1); // the skill's OWN content version, pinned
  });

  // =========================================================================
  // (e) promoting the winning run — R4, which differs from the LIVE agent
  //     ONLY in its skill set — still appends a new version whose snapshot
  //     matches what R4 actually measured (AC-27, the R-7 hole)
  // =========================================================================
  it('(e) promoting a run that differs only in its skill set still appends a new version, matching what that run measured', async () => {
    const liveBefore = await agentsRepo.getById(workspaceId, agentId);
    expect(liveBefore!.version).toBe(versionAtR4); // unchanged since R4 (setSkills bumps nothing)
    expect((await agentsRepo.linkedSkills(agentId)).map((l) => l.skill.id)).toEqual([skillId]);

    // R4 (recall 1.0) is BETTER than R5 (recall 0.8, the most recent other
    // run) — promoting it is an IMPROVEMENT, so no regression ack is needed.
    const result = await service.promote(workspaceId, R4.id);

    expect(result.agent_version).toBe(versionAtR4 + 1); // a NEW version, even though only skills differ
    expect(result.effective_config.skills).toEqual([]); // matches what R4 pinned — the regression skill is GONE
    expect(result.effective_config.system_prompt).toBe(PROMPT_IMPROVED);

    const liveAfter = await agentsRepo.getById(workspaceId, agentId);
    expect(liveAfter!.version).toBe(versionAtR4 + 1);
    expect(await agentsRepo.linkedSkills(agentId)).toEqual([]);

    const versions = await agentsRepo.listVersions(agentId);
    const newest = versions[0]!;
    expect(newest.version).toBe(versionAtR4 + 1);
    expect((newest.configJson as { skills: string[] }).skills).toEqual([]);
  });
});
