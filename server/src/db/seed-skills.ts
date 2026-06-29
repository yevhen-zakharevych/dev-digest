import type { SkillSource, SkillType } from '@devdigest/shared';

/**
 * Built-in skills seeded into a fresh workspace. Test Quality Reviewer
 * (also seeded) is linked to all of these in order. Bodies are markdown
 * prepended into the agent's prompt at run time as a `## Skills / rules` block.
 *
 * One of the four is sourced from the L02 demo ("imported" via the UI in the
 * walkthrough) so the import → preview → save path is exercised end-to-end.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
}

export const TEST_QUALITY_SKILLS: SeedSkill[] = [
  {
    name: 'uncovered-branches',
    description:
      'Detect new conditionals / error paths in the diff that no test assertion exercises.',
    type: 'rubric',
    source: 'manual',
    body: `# Uncovered branches

For every NEW conditional, switch arm, early return, or thrown error in the
production diff, find a test assertion that observes its outcome. If none does,
report it as a finding.

## Checklist
- New \`if\` / \`else\` arm → at least one test reaches each side.
- New \`switch\` case → at least one test asserts behaviour for that case.
- New \`throw\` / \`reject\` / non-2xx return → a test triggers it AND asserts on
  the failure shape (status code, error message, error \`code\` field).
- Guard clause / early return → a test pins the short-circuited result.

## How to report
- Cite the production file:line of the uncovered branch.
- Name the missing test: \`test_file.test.ts — "handles X when Y"\`.
- State the assertion the test would make ("expects 422 and { code: 'validation_error' }").
- Severity: CRITICAL if the branch is on a hot/load-bearing path
  (auth, payment, data integrity); WARNING otherwise.

Stay silent on branches that are clearly covered. Do NOT pad — zero findings is
a valid outcome when every new branch already has an assertion.`,
  },
  {
    name: 'corner-cases',
    description:
      'Flag missing tests at the boundary conditions the diff introduces (empty, null, off-by-one, tz, unicode).',
    type: 'rubric',
    source: 'manual',
    body: `# Corner cases

A test on the happy path proves the function CAN work; a test at the boundary
proves it WILL work. Flag missing assertions at the edges this diff introduces.

## Boundaries to look for
- Empty input ([], '', {}, no rows).
- Zero / negative numbers where positive is the expected case.
- \`null\` and \`undefined\` distinct from "missing".
- Off-by-one on limits (== max, == max+1, == 0).
- Pagination edges (page=0, page>total, page_size=1).
- Unicode / multi-byte / RTL strings where the code touches \`.length\` or slicing.
- Concurrent identical requests (idempotency, race).
- Timezones / DST when the diff touches dates.

## How to report
- Cite the production line that introduces the boundary.
- Name the missing test and the input value it should cover.
- Severity WARNING by default; CRITICAL if the boundary is on a hot path AND
  the wrong-branch behaviour would silently corrupt data.

Don't invent boundaries the code doesn't have. If a function never sees user
input, "what about unicode" is not a finding.`,
  },
  {
    name: 'over-mocking',
    description:
      'Spot tests that stub the behavior under test (tautologies) or simulate impossible states.',
    type: 'rubric',
    source: 'manual',
    body: `# Over-mocking

A test that mocks the layer it's supposed to verify proves nothing. Flag the
two failure modes below.

## Tautology mocks
The test under \`describe('repository.foo')\` mocks the DB query the repository
issues and then asserts the result of that very mock. The test passes even if
the SQL is wrong. Pattern:

\`\`\`
vi.mock('./db', () => ({ db: { query: () => MOCK_ROWS } }));
expect(await repo.foo()).toEqual(MOCK_ROWS); // proves nothing
\`\`\`

Replace with a real query against a test DB, or assert on the SQL/parameters
the repository emits — not on the rows the mock returned.

## Impossible-state mocks
The test simulates a state the real adapter NEVER produces (e.g. \`fetch\`
returning \`undefined\` body with status 200). The test exercises a contract that
doesn't exist; it can pass while the real path crashes.

## How to report
- Cite the test file:line where the suspect mock is set up.
- Name the contract the mock fakes and why the real path can't produce it.
- Suggest the replacement (real adapter in a test container, or an assertion
  on the call arguments instead of the mock's return).`,
  },
  {
    name: 'flake-patterns',
    description:
      'Catch sleeps / real time / shared state / unseeded randomness that will make CI red intermittently.',
    type: 'rubric',
    source: 'manual',
    body: `# Flake patterns

A test that is non-deterministic will go red on someone else's clock and
they will mute it. Catch flakes before they ship.

## Patterns to flag
- \`await sleep(N)\` or \`setTimeout\` in test setup with a fixed delay — replace
  with a poll-until-condition helper that has an explicit timeout.
- \`new Date()\` / \`Date.now()\` / \`performance.now()\` compared with literal
  ranges — install a fake clock (\`vi.useFakeTimers()\`) or compute the expected
  value from the current clock.
- Module-scoped mutable state between tests (\`let counter = 0\` at the top of
  the file) — move into \`beforeEach\` or seed per test.
- Order-dependent setup (test B reads a row test A inserted) — make each test
  create its own fixtures.
- \`Math.random\` / \`crypto.randomUUID\` without a seed inside an assertion —
  seed the RNG or assert on shape, not the exact value.
- Real network in tests — intercept with msw or stub the adapter.

## How to report
- Cite the test file:line of the flake source.
- Name the pattern (sleep, shared state, real clock, …).
- Suggest the fix (fake clock, per-test fixture, msw, seeded RNG).
- Severity: CRITICAL if the pattern is in the test that gates a release path;
  WARNING for an isolated/internal test.`,
  },
];
