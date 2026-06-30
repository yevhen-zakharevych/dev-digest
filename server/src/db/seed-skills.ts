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

export const API_CONTRACT_SKILLS: SeedSkill[] = [
  {
    name: 'breaking-change',
    description:
      'Detect removed or renamed public fields, route paths, or HTTP methods that break existing callers.',
    type: 'rubric',
    source: 'manual',
    body: `# Breaking change

A breaking change is any removal or rename of a public contract element — a response field,
a route path, an HTTP method, or a query/body parameter — that callers depend on. Even a
cosmetic rename (\`userId\` → \`user_id\`) is breaking if callers are not co-deployed.

## What to look for
- A field key renamed in a Zod schema, TypeScript interface, or serialised response object.
- A route path segment changed (\`/users/:id/roles\` → \`/users/:id/permissions\`).
- An HTTP method changed (\`PUT\` → \`PATCH\`) on an existing endpoint.
- A required request parameter removed (callers that send it may fail validation).
- A public export renamed or removed from a shared contract package.

## Good
\`\`\`ts
// New field added alongside old one — old callers still work
z.object({ userId: z.string(), user_id: z.string() }) // transitional dual-key
\`\`\`

\`\`\`ts
// Route versioned — old path still works
router.get('/v1/users/:id', ...) // old
router.get('/v2/users/:id', ...) // new path; both served
\`\`\`

## Bad
\`\`\`ts
// Field renamed with no transition period
- z.object({ userId: z.string() })
+ z.object({ user_id: z.string() }) // existing callers reading \`.userId\` receive undefined
\`\`\`

\`\`\`ts
// Endpoint moved with no redirect or versioning
- router.post('/api/payments/charge', handler)
+ router.post('/api/billing/charge', handler)
\`\`\`

## How to report
- Cite the file:line of the renamed/removed element.
- State the old shape and the new shape side by side.
- Name the callers broken (client code, external consumers, other services).
- Suggest the migration path: dual-key transition, version gate, or deprecation first.
- Severity: CRITICAL for removal/rename on a live consumer-facing contract;
  WARNING if the field is internal or no external callers are evident.`,
  },
  {
    name: 'response-schema',
    description:
      'Detect type changes or optionality shifts in response shapes that silently break strict consumers.',
    type: 'rubric',
    source: 'manual',
    body: `# Response schema

A schema drift finding covers changes to the *type* or *presence guarantee* of a field that
callers already depend on — even when the field key itself is unchanged. These are invisible
to rename detection but are equally breaking.

## What to look for
- A field changes type: \`string\` → \`number\`, \`boolean\` → \`string\`, object → array.
- A field narrows or widens nullability: \`string | null\` → \`string\` (widening — callers that
  guard null now have dead branches) or \`string\` → \`string | null\` (narrowing — callers that
  dereference directly now crash).
- A field changes from optional (\`z.string().optional()\`) to required, or vice versa.
- A nested object's shape changes: a guaranteed sub-key disappears or becomes optional.
- An array element type changes.

## Good
\`\`\`ts
// Adding a NEW optional field — existing callers ignore it safely
z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().optional(), // new; callers that don't know it still parse fine
})
\`\`\`

## Bad
\`\`\`ts
// Field that was always present becomes nullable — callers that do \`.score.toFixed()\` crash
- score: z.number(),
+ score: z.number().nullable(),

// Field type changed — callers that parse as number now get a string
- count: z.number(),
+ count: z.string(),

// Required field added — callers that don't send it fail validation
- z.object({ name: z.string() })
+ z.object({ name: z.string(), workspaceId: z.string() }) // now required
\`\`\`

## How to report
- Cite the file:line of the Zod schema, TypeScript type, or serialised shape.
- Show old type vs new type explicitly.
- State the category: nullable drift / type change / optionality flip / new required field.
- Severity: CRITICAL if any consumer that was correct before is now broken at runtime;
  WARNING if the change can break strict/typed consumers but has a safe runtime fallback.`,
  },
  {
    name: 'semver-discipline',
    description:
      'Flag breaking or additive API changes that are missing the corresponding semver version bump or version-gate.',
    type: 'rubric',
    source: 'manual',
    body: `# SemVer discipline

SemVer (Semantic Versioning) maps change type to version increment:
- **MAJOR** (vX+1) — any breaking change: removal, rename, type change, required field added.
- **MINOR** (vX.Y+1) — backwards-compatible addition: new optional field, new endpoint.
- **PATCH** (vX.Y.Z+1) — bug fix with no contract change.

## What to look for
- A breaking change (covered by \`breaking-change\` and \`response-schema\` rules) with no
  corresponding \`/v2/\` route prefix, no version header (\`Api-Version\`), no \`version\` field
  bumped in \`package.json\` or a version constant, and no migration guide in the PR description.
- A purely additive change (new optional field, new endpoint) shipped as a patch — technically
  allowed by semver but worth flagging when the service contract is versioned explicitly.
- A version constant or \`package.json\` version that was bumped to the WRONG tier (e.g.
  a breaking change bumped as a minor).

## Good
\`\`\`ts
// Breaking rename gated behind a new version path
router.get('/v1/orders/:id', legacyHandler) // old contract still served
router.get('/v2/orders/:id', newHandler)    // new contract under /v2/
\`\`\`

\`\`\`json
// package.json bumped correctly for a breaking change
- "version": "3.4.1"
+ "version": "4.0.0"
\`\`\`

## Bad
\`\`\`ts
// Breaking field rename shipped with only a patch bump
- "version": "2.1.3"
+ "version": "2.1.4"
// and simultaneously: userId → user_id in the response schema
\`\`\`

\`\`\`ts
// Breaking change with no version signal at all
- router.delete('/api/users/:id/sessions', handler) // removed, no /v2/ alternative
\`\`\`

## How to report
- Cite the breaking change (file:line) and the version signal (or its absence).
- State which semver tier is required and which was applied (or missing entirely).
- Suggest the fix: add a versioned path, bump the correct tier, or add a migration note.
- Severity: CRITICAL if a breaking change ships with no version gate whatsoever;
  WARNING if versioned but the wrong tier was bumped.`,
  },
  {
    name: 'deprecation-policy',
    description:
      'Ensure APIs are marked @deprecated before removal; flag removals that skip the deprecation step.',
    type: 'rubric',
    source: 'imported_url',
    body: `# Deprecation policy

A removal without prior deprecation is a surprise for every consumer. The policy is:
1. Mark the element \`@deprecated\` (JSDoc, OpenAPI \`deprecated: true\`, or a runtime warning).
2. Communicate the removal timeline (at least one release cycle).
3. Only then remove it in a later diff.

A single diff that adds AND removes in one step skips step 1 and 2.

## What to look for
- A field, endpoint, or export deleted from this diff that has no \`@deprecated\` tag in the
  surrounding surviving code (i.e., the tag was never added in a prior commit).
- A \`@deprecated\` tag added AND the element removed in the SAME diff — the tag must appear
  first, in a separate release.
- A runtime deprecation warning (console.warn, logger.warn) added in the same diff as the
  removal — same issue.
- An OpenAPI/Swagger spec field marked \`deprecated: true\` removed in the same PR.

## Good
\`\`\`ts
// PR 1 — only the deprecation; element still present
/** @deprecated Use \`user_id\` instead. Will be removed in v4. */
userId: z.string(),
user_id: z.string(),

// PR 2 (later release) — now the removal is safe
- userId: z.string(),
  user_id: z.string(),
\`\`\`

## Bad
\`\`\`ts
// Removal in the same diff as the deprecation tag — consumers had no warning period
+ /** @deprecated */
- userId: z.string(),

// Removal with no deprecation at all
- router.get('/api/v1/legacy-export', legacyHandler)
// no @deprecated, no changelog entry, no migration guide
\`\`\`

## How to report
- Cite the file:line of the removed element.
- State whether a \`@deprecated\` tag existed before this diff (check surrounding surviving code).
- If the tag was added in THIS diff alongside the removal, note that the two steps must be split.
- Severity: CRITICAL if the removed element is a public/consumer-facing contract with
  documented callers and no prior deprecation; WARNING if it appears internal or the deprecation
  was added earlier in the same PR branch (in a previous commit).`,
  },
];

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
