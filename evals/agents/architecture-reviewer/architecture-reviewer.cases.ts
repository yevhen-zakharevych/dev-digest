import { fixtureReader, type AgentCase } from "../../src/index.js";

/**
 * Cases for the `architecture-reviewer` subagent.
 *
 * Practice wording follows the three llmJudge rules learned in INSIGHTS.md:186 — one practice =
 * one assertion; every practice answerable from its own prompt; a negative practice always gets a
 * positive carrier (the judge PASSes only on a verbatim quote, and absence has no quote).
 *
 * `maxTurns` is set from the turns the case ACTUALLY burned, with headroom: a session that runs out
 * of turns dies before emitting its report, and its partial transcript then reads to the judge as a
 * terrible review (it is now caught — case.ts asserts `!isError` — but a case that has to be thrown
 * away measures nothing). scope-bait is the deepest: it has been seen taking 22 turns.
 */
const fx = fixtureReader(import.meta.url);

const ask = (diff: string) =>
  `Review this diff for architectural quality and report your findings.\n\n${diff}`;

// Textbook, framework-agnostic violations: a domain file importing Fastify, and a concrete
// adapter constructed inside a service instead of at the composition root. Both variants should
// FIND both — the model volunteers this much unprompted. The discriminator is whether it NAMES
// the principle it is invoking.
const LAYERING = ask(fx("layering.diff"));

// The same question, but the violated rules are DevDigest-specific ("reviewer-core does no I/O",
// "groundFindings() is a mandatory gate"). A competent model describes both problems in prose
// either way; only an agent that is ordered to cite the rule reliably names the contract.
const REVIEWER_CORE = ask(fx("reviewer-core-gate.diff"));

// One genuine architecture violation (a hand-rolled type duplicating a shared Zod contract) plus
// one carve-IN (a secret read via process.env, which the agent's own quality bar says to report as
// a composition-root/port violation rather than as a security finding), buried in bait the agent is
// told not to raise AS A FINDING: an off-by-one, a one-letter name, and an O(n²) dedup scan.
// Every bait is architecturally INERT by construction — an earlier version merged confidence scores
// inside the nested loop, which made the "slow loop" a genuine misplaced-business-logic finding
// (checklist item 9), so the agent was punished for a correct call. The dedup is now mechanical:
// a perf reviewer has plenty to say about it, an architecture reviewer has nothing.
const SCOPE_BAIT = ask(fx("scope-bait.diff"));

// The FALSE-NEGATIVE guard, and the reason it exists: the scope rules that keep the bait OUT of the
// findings list are the same rules that could push a REAL violation out of it. This diff carries one
// — a component calling `fetch()` directly instead of going through `lib/hooks/<domain>.ts` →
// `lib/api.ts` — which is (a) genuinely architectural, (b) named explicitly in the agent's own layer
// map, and (c) NOT any of the nine items in its "What to look for" checklist. Verified against the
// live tree: `client/src/lib/hooks/*` and `client/src/lib/api.ts` exist and no component currently
// calls `fetch()`, so the rule is real and upheld. An agent that reports this only under an
// out-of-scope heading — or not at all — has traded false positives for false negatives, which is
// the one way a scope-discipline fix can make the reviewer WORSE. Both variants must pass this.
const OFF_CHECKLIST = ask(fx("off-checklist.diff"));

// Violates nothing: a local rename inside a pure function, no new imports, no new cross-layer edge.
// The correct report is empty. Measures the cost of any prompt change in false positives.
const BENIGN = ask(fx("benign-refactor.diff"));

export const cases: AgentCase[] = [
  {
    name: "flags the layering violations and names the principle behind each",
    kind: "quality",
    prompt: LAYERING,
    practices: [
      "flags the `import type { FastifyRequest } from 'fastify'` newly added to the domain file `pricing.ts` as a violation — a domain/core file must not depend on the web framework",
      "names the architectural principle violated by that domain-imports-Fastify finding — for example 'Dependency Rule', 'inward-only dependencies', or 'transport leakage'",
      "flags `new GithubAdapter(...)` being constructed as a field inside `CheckoutService` as a violation — concrete adapters belong at the DI composition root (`platform/container.ts`), not inside business logic",
      "names the architectural principle violated by that ad-hoc adapter construction — for example 'composition-root discipline' or 'dependency injection'",
      "assigns every finding a severity drawn from exactly three levels: CRITICAL, WARNING, or SUGGESTION",
      "anchors every finding to a concrete file path with a line number, in `path/to/file.ts:LINE` form",
    ],
    threshold: 0.8,
    maxTurns: 20,
  },
  {
    name: "names the DevDigest-specific contract broken in reviewer-core",
    kind: "quality",
    prompt: REVIEWER_CORE,
    practices: [
      "flags the new `import { readFileSync } from 'node:fs'` in `reviewer-core/src/review/run.ts` as a violation — reviewer-core is a pure engine that performs no I/O beyond the injected LLMProvider",
      "names the principle or contract broken by that filesystem import — for example 'domain purity', 'the Dependency Rule', or 'reviewer-core is I/O-free'",
      "flags that `groundFindings()` is no longer called, so the findings are returned without passing the citation-grounding gate",
      "names the contract broken by the skipped gate — that the grounding gate is mandatory and must never be bypassed",
      "rates at least one of these two findings CRITICAL",
    ],
    threshold: 0.8,
    maxTurns: 25,
  },
  {
    name: "stays in the architecture lane on a diff baited with a bug, a bad name, and a slow loop",
    kind: "quality",
    prompt: SCOPE_BAIT,
    practices: [
      "flags the hand-rolled `ConventionCandidate` interface as contract duplication — it re-declares an existing `@devdigest/shared` Zod contract instead of importing the schema-derived type",
      "frames the direct `process.env.GITHUB_TOKEN` read as an architectural boundary violation — secrets belong behind the injected SecretsProvider / the composition root — rather than as a security vulnerability",
      // NOTE: a fourth practice used to sit here — "explicitly SAYS the bait is out of scope".
      // Deleted, not weakened: it scored 33% regardless of prompt strictness, because the prompt
      // never requires that declaration — it says "never flag", not "declare what you skipped".
      // The practice was testing the eval author's wish rather than the artifact's contract, and a
      // practice the artifact can't satisfy measures nothing but its own wording.
      "the numbered FINDINGS list holds structural findings only — quote the finding headlines as evidence; if any numbered finding's subject is the off-by-one bug, the variable naming, or the dedup scan's performance, this practice FAILS",
    ],
    // LOWERED 0.75 → 0.6 deliberately, and the trade is NOT free — read this before raising it back.
    //
    // At 0.75 (with three practices, i.e. "all three must pass") the case gated the clean-list
    // practice. But that practice is only ~67% reliable on the target model: measured at n=3, the
    // full agent keeps the numbered list free of the bait in 2 runs out of 3 (INSIGHTS.md). A gate
    // that goes red on a third of runs with NO change to the agent is not a gate — it is a coin
    // flip that gets switched off within a week (see the `pr-self-review` entry in INSIGHTS.md on
    // gates that are already red against a clean tree).
    //
    // So CI now gates only the STRUCTURAL work (practices 1-2, which are reliable): did the reviewer
    // find the contract duplication and the secrets-boundary violation. Scope discipline is no
    // longer a merge gate — the case stays GREEN at 2/3 even when the bait leaks into the numbered
    // list.
    //
    // It is still MEASURED, just not gated: record() persists every practice's PASS/FAIL
    // independently of this threshold (records/record.ts), and aggregate() keys its series by
    // practice text (records/stats.ts) — so `pnpm eval:repeat` still reports the clean-list rate.
    // Watch it there, at n>=5; a single run was never a measurement of it anyway.
    threshold: 0.6,
    maxTurns: 30,
  },
  {
    name: "reports an off-checklist architectural violation instead of burying it out of scope",
    kind: "quality",
    prompt: OFF_CHECKLIST,
    practices: [
      "flags the `fetch()` call inside the `ReviewSummary` component as an architectural violation — a client component must not call the API directly; requests belong in `src/lib/hooks/<domain>.ts` → `src/lib/api.ts`",
      "raises that finding in the numbered FINDINGS list with a severity, NOT under an out-of-scope / other-reviewer / 'noted, not findings' heading — quote the numbered finding as evidence; if the direct `fetch()` appears only outside the numbered list, or not at all, this practice FAILS",
    ],
    threshold: 1.0,
    // The agent reads half of client/ to convince itself the hooks→api rule is real before it will
    // call this a violation — 23 turns observed on the baseline run. A 20 cap killed the session
    // mid-investigation and (correctly) surfaced as a dead run, not as a false negative.
    maxTurns: 30,
  },
  {
    name: "reports nothing on a benign rename instead of padding the report",
    kind: "quality",
    prompt: BENIGN,
    practices: [
      "reports zero architectural findings for this diff — the FINDINGS section is empty or plainly states that there are none",
      // Deliberately NOT scoped to the SUMMARY section and NOT a conjunction of three claims: a
      // correct report was once FAILed here because it said "no new imports, no dependency
      // direction issues" in a findings bullet rather than in the summary paragraph.
      "asserts anywhere in the report that the change is architecturally neutral — that it has no architectural impact / crosses no layer boundary / is a pure local rename; any wording of that claim PASSES",
    ],
    threshold: 1.0,
    // Even the trivial case explores the repo before concluding "nothing here" — 10 turns observed,
    // and a 12 cap still killed a session. A benign diff is not a cheap diff to be SURE about.
    maxTurns: 20,
  },
];
