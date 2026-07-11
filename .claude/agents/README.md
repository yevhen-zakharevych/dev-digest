# Agents

Custom Claude Code sub-agents for DevDigest. Each agent is a single `<name>.md`
file: YAML frontmatter (routing + config) followed by a Markdown system prompt.
Shared with the team via version control.

## Catalog

| Agent | Model | Access | Purpose |
|-------|-------|--------|---------|
| [spec-creator](spec-creator.md) | Opus | write **only** `specs/**` (`Read/Glob/Grep/Bash/WebFetch/Write/Edit/Agent/AskUserQuestion`) | Authors a **spec** (WHAT/WHY) before any plan exists, from a request plus design sources (text, screenshots, code). EARS acceptance criteria with `AC-N` ids, edge cases, cross-module interactions, contract shapes. Analyses the design for gaps and UX holes; asks blocking questions via `AskUserQuestion`, queues the rest as `[NEEDS CLARIFICATION]`. Never writes code or the "how". |
| [implementation-planner](implementation-planner.md) | Opus | write **only** `docs/plans/**` (`Read/Grep/Glob/Bash/Agent/Write`) | Turns an **existing spec / requirements set** into a structured **Implementation Plan** written to `docs/plans/<slug>.md`; reviews the requirements (gaps, contradictions, ambiguity, testability), asks clarifying questions, recommends improvements, and decomposes work into parallelizable tasks naming the skills each must apply. Reuses the spec's `AC-N` ids verbatim. Fans out `researcher`s for broad exploration; never runs a test suite. Never authors the spec. |
| [implementer](implementer.md) | Sonnet | write (`Read/Edit/Write/Bash/Grep/Glob/Skill`) | Implements **one scoped task** from a plan (UI or backend), applies the skills its card names, keeps existing tests green, self-reviews only the code it wrote. A failure in a file it does not own is reported, never fixed. Returns insights; writes no `INSIGHTS.md`. |
| [researcher](researcher.md) | Sonnet | read-only | Finds information in the codebase or on the web and returns a structured, scannable report. |
| [test-writer](test-writer.md) | Sonnet | write (`Read/Edit/Write/Bash/Grep/Glob/Skill`) | Writes automated tests for UI (Vitest + RTL) or backend (Vitest unit + `*.it.test.ts` testcontainers). **Spawn it with the spec path + the `AC-N` ids to cover** — expected values come from the spec, never from the implementation. Runs the suite to green then mutation-checks; never weakens an assertion to pass. Returns insights; writes no `INSIGHTS.md`. |
| [architecture-reviewer](architecture-reviewer.md) | Opus | read-only (`permissionMode: plan`) | Reviews a diff for **architectural** quality (layering, dependency direction, module boundaries, misplaced business logic) — **not** line bugs, style, security, or perf; it will skip those by design (use `/code-review high` and `/security-review`). Returns a findings report; empty is a valid result. |
| [plan-verifier](plan-verifier.md) | Sonnet | read-only (`permissionMode: plan`) | Given a plan **and** the code written, verifies every requirement is actually implemented — one row per requirement, `file:line` evidence for each MET, four statuses (MET/PARTIAL/MISSING/CANNOT VERIFY). Coverage, not code quality. |
| [doc-writer](doc-writer.md) | Sonnet | write (`Read/Edit/Write/Bash/Grep/Glob/Skill`) | Documents shipped functionality, turns plans into docs, converts material into docs with Mermaid diagrams. Classifies by Diátaxis, knows where docs live in the repo, grounds every claim in `file:line`. |

## How the planning agents work together

`spec-creator` runs first, when a feature has no written spec yet. It is the only
agent that authors the **WHAT/WHY**: it reads the request plus any design sources
(pasted description, screenshots, existing code), hunts the design for gaps,
uncovered corner cases, cross-module interactions and UX holes, asks the user its
blocking questions via `AskUserQuestion`, and writes one spec file with EARS
acceptance criteria (`AC-N`). It is the only agent allowed to write into `specs/`,
and it may write **nothing else** — that boundary is enforced by its system prompt,
not by tooling, since `tools:` cannot scope `Write` to a directory. Its `AC-N` ids
are what `plan-verifier` later traces coverage against.

Skip `spec-creator` when a spec (or an equivalent requirements set) already exists —
`implementation-planner` takes that as its input and never authors one.

`implementation-planner` runs second. It takes an **already-written spec or
requirements set** as input — it never authors one. It reviews those
requirements (gaps, contradictions, ambiguity, testability), asks clarifying
questions (stopping outright on a blocking one), offers recommendations, explores
the code, reads the relevant `INSIGHTS.md` / `AGENTS.md`, and emits a plan whose
task table is decomposed **by file ownership** and traced back to the spec's own
`AC-N` ids. Each task names its owned files, the skills to apply, and the tests to
run. Like `spec-creator`, it **writes exactly one file** — its plan, at
`docs/plans/<slug>.md` — and returns only that path plus a short summary, so a
several-hundred-line plan is not paid for twice (once as agent output, again as the
orchestrator re-reads it). That boundary is held by its system prompt, not by tooling.
For broad exploration it fans out parallel `researcher` sub-agents with narrow briefs,
keeping explored file bodies out of its Opus context; and it never runs a test suite —
its `Bash` allowlist is inspection commands only.
`implementer` agents then run **in parallel in the same working tree** (no
worktree isolation) — collision safety comes entirely from the planner's
non-overlapping file ownership. The plan is the contract; each implementer gets one
self-contained task in its spawn prompt.

**`AC-N` is the one id that survives the whole chain.** `spec-creator` mints it, the
planner reuses it verbatim (never renumbering to `R1…Rn`), each task's acceptance
criteria discharge specific ones, `test-writer` asserts them, and `plan-verifier`
returns a verdict per id. Renumber anywhere along that chain and the verifier ends up
checking the code against the *plan* rather than the *spec* — a criterion dropped
during planning then becomes invisible, and every report still comes back green.

## The full loop, and why the phases sit in this order

The ordering principle: **the cheapest signal first, and the artifact that is most
expensive to redo last.** Tests are the most expensive artifact here — `test-writer`
runs each one twice (green against correct code, then mutated to confirm it goes red).
Writing them before the code's shape is settled throws that work away the moment an
architecture finding moves a function.

```
request + design sources → spec-creator (Opus, writes specs/** only)
                          │  blocking gap ⇒ AskUserQuestion; rest ⇒ [NEEDS CLARIFICATION]
                          ▼
                      Spec — WHAT/WHY, EARS AC-N ids
                          │
                          │  (already have a spec? start here instead)
                          ▼
                      implementation-planner (Opus, writes docs/plans/** only)
                          │  reviews requirements; blocking gap ⇒ questions only, no file
                          ▼
              docs/plans/<slug>.md  (AC-N → task, by file ownership)
                          ▼
   ① implementer ×N (Sonnet) — parallel, one task card each
      │   existing tests stay green; a failure in a file you don't own ⇒ report, don't fix
      ▼
   ② three read-only passes, SPAWNED IN ONE MESSAGE (they are independent):
      ├─ plan-verifier (Sonnet)        — is every AC-N actually implemented?
      ├─ architecture-reviewer (Opus)   — layering, boundaries, misplaced logic
      └─ /code-review high (skill)     — correctness bugs   ← see "the correctness gap"
      ▼
   ③ one fix round — amended task cards, never a full-plan re-onboard
      ▼
   ④ test-writer ×N (Sonnet) — parallel by file-set, spec path + AC-N ids in the
      │                        spawn prompt (NOT just the code — see below)
      ▼
   ⑤ plan-verifier, short second pass — only the Definition-of-Done rows and the
      │                                 rows that came back MISSING/PARTIAL in ②
      ▼
   ⑥ pr-self-review skill — the pre-PR gate; blocks on any CRITICAL
      ▼
   ⑦ orchestrator writes INSIGHTS.md once, from the agents' reports
```

Phase ② is the change that matters most for wall-clock: `plan-verifier` and
`architecture-reviewer` are both read-only, both consume the same diff, and neither
depends on the other's output. Running them sequentially buys nothing. Phase ⑤ is
cheap because it only re-checks the delta.

### The correctness gap (why `/code-review` is in the loop)

`architecture-reviewer` explicitly refuses correctness bugs, security issues, and
performance concerns — its Quality bar sends each to "the correctness reviewer", "the
security reviewer", "the performance reviewer". **None of those agents exist in this
directory.** Do not ask `architecture-reviewer` to find bugs; by its own prompt it will
skip them. Cover that lane with the built-in skills instead: `/code-review high` for
correctness, `/security-review` for security, and `pr-self-review` as the pre-PR gate.

### `test-writer` must be handed the spec

`test-writer`'s worst failure mode is the **self-verification loop**: derive the expected
value from the implementation, and the test agrees with the code while the real behavior
stays broken. Its prompt forbids this — but only the spawn prompt can prevent it. **Give
every `test-writer` the spec file path and the `AC-N` ids it must cover.** The `AC-N`'s
`_(observable: …)_` hint is written precisely to be the assertion. A `test-writer` spawned
with the diff alone has no source of truth and will mirror whatever the code does.

### Insights are collected, not written in parallel

`implementer` and `test-writer` run in parallel and each used to append to the same
`<module>/INSIGHTS.md` — the concurrent-append collision that disjoint file ownership
exists to prevent (see root `INSIGHTS.md:27`). Both now **return** an `## Insights`
section in their report and touch no file; the orchestrator invokes
`engineering-insights` once, after the fan-out (phase ⑦).

## Orchestration policy (token/cost right-sizing)

The catalog `model` column is each agent's **default**. The orchestrator (main
thread) may **override the model per spawn** and **fuse tasks** to cut cost and
repeated onboarding, without touching quality.

**Model routing — pick the cheapest model the task shape allows, escalate only for
real cross-module integration or architectural judgment:**

| Task shape | Model |
|---|---|
| Mechanical edit, ≤3 files, no new logic (e.g. flip constants, add i18n strings) | **Haiku** |
| Self-contained, well-specified helpers / client hooks / single-surface UI | **Sonnet** |
| Read-only research | **Sonnet** |
| Requirement-coverage verification (`plan-verifier`) | **Sonnet** (structured AC-N tracing — Opus is marginal gain at 2× cost) |
| Hard cross-module integration (adapters + `container.ts` + wiring) | **Opus** |
| Planning (spec authoring + implementation planning) | **Opus** |
| Architecture review | **Opus** (restored 2026-07-10 — quality over token economy) |

**Model floor (never break):** any task that touches `platform/container.ts`,
adapters, or cross-module wiring runs on **Opus** regardless of size.

**Task batching:** the `implementation-planner` tags disjoint, fuseable tasks with a shared **Batch**
id. Fuse them into a single implementer spawn to pay onboarding once — but **never
batch across a `Depends-on` edge or a shared-contract two-file edit.**

**Task cards, not the whole plan:** hand each implementer only its plan row (the
self-contained card), never the full plan doc. Feed review fixes back as **amended
cards**, not a fresh full-plan re-onboard.

**Scoped researcher briefs:** give each researcher a dirs-allowlist, tell it to skip
`clones/`, and assign shared contracts (`platform.ts`, `brief.ts`, …) to exactly one
researcher so the others skip them.

**Verifier trusts green:** after implementers hand off passing suites, `plan-verifier`
(and reviewers) confirm coverage by **reading** tests + spot-checking — not by re-running
the full `unit + .it.test + Docker` suites the implementers already passed. Re-running
green duplicates expensive work; reading the assertions is what catches a test that
passes while asserting the wrong thing. (Codified as `plan-verifier.md` Hard rule 7.)

## Skill wiring (hybrid)

The agents use the repo's `.claude/skills/`, loaded two different ways:

- **implementation-planner** — *preloads* only the two architecture skills
  (`onion-architecture`, `frontend-architecture`) via the `skills:` frontmatter
  field, so it plans against real Ports-&-Adapters / frontend-layout rules. All
  other skills it merely *names* per task (it never invents a name).
- **implementer** — invokes skills *dynamically* via the `Skill` tool (nothing
  preloaded, since it works on both UI and backend). It applies **the skills its
  task card names, and no others** — the planner already decided which practices
  bear on those files, and loading an unnamed skill costs hundreds of lines of
  rules for code the task does not touch. The full backend / UI sets are a
  backstop for a card that names none. A `@devdigest/shared` edit always pulls in
  `zod`, card or no card.
- **test-writer** — invokes skills *dynamically* via the `Skill` tool (works on
  both sides, so nothing preloaded): `react-testing-library` + the UI set for
  `client/**`, the backend set for `server/**` & `reviewer-core/**`, always
  `typescript-expert` (and `security` for input/auth tests).
- **architecture-reviewer** — *hybrid*: *preloads* `onion-architecture` +
  `frontend-architecture` via `skills:` (same rationale as the planner: it reviews
  against the real layering rules), AND keeps the `Skill` tool to *invoke* any
  other skill on demand when a diff needs it (`zod`, `security`, the backend/UI
  sets). `permissionMode: plan` keeps it read-only regardless — invoking a
  skill only loads instructions, it writes nothing.
- **doc-writer** — invokes `mermaid-diagram` *dynamically* via the `Skill` tool
  when a diagram earns its place; no preload.
- **plan-verifier** — *neither* preloads nor carries the `Skill` tool. Its lens is
  requirement coverage, not architecture, so it stays lean and only *names*
  principles (`onion-architecture`, `zod`, `security`, …) when judging correctness.

Rule of thumb: to load a skill's *body* at startup use `skills:`; to let an agent
*invoke* skills on demand keep `Skill` in its `tools:`. See root `INSIGHTS.md`
(Tool & Library Notes) for the full distinction.

## What these agents are based on

`implementation-planner` and `implementer` were designed from official Anthropic guidance and
vetted practitioner patterns (researched 2026). Key practices applied:

- **Single-responsibility agents** + **description-as-routing-trigger** +
  **minimal per-agent toolset** — [Create custom subagents, Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- **Planner constrained by prompt, not by `permissionMode: plan`** — it carries `Write`
  so it can emit `docs/plans/<slug>.md` directly instead of round-tripping a long plan
  through the orchestrator's context; `tools:` cannot scope `Write` to a directory, so
  the boundary lives in its Hard rule 1, exactly as `spec-creator` scopes itself to
  `specs/**` — [Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- **Planner delegates breadth, keeps depth** — parallel `researcher` sub-agents with
  dirs-allowlist briefs, so raw exploration lands in Sonnet contexts and only the
  conclusions reach the Opus planner — [How we built our multi-agent research system, Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- **Structured multi-section plan skeleton** (no code in the plan; per-phase risk +
  dependency ordering) — [ECC `planner.md`, affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/blob/main/agents/planner.md)
- **Requirements review before design** (completeness / consistency / ambiguity /
  testability, plus a requirement→task traceability matrix) — the planner consumes
  a spec, it never authors one; see `plan-verifier.md`, which closes the same loop
  after implementation.
- **Test suite as the stopping criterion** (loop write→test→fix until green; the
  agent never judges its own output) — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- **Light, scoped diff self-review** (code + tests only, not a deep design review) —
  [code-reviewer example, Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- **Divide parallel work by file ownership, never the same file** — [How we built our
  multi-agent research system, Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
  and [Orchestrate teams of Claude Code sessions](https://code.claude.com/docs/en/agent-teams)
- **Detailed spawn prompt** (subagents don't inherit the parent's chat history) —
  [Agent teams, Claude Code Docs](https://code.claude.com/docs/en/agent-teams)
- **Hybrid skill loading** (`skills:` preload vs `Skill`-tool dynamic invocation;
  progressive disclosure) — [Sub-agents Docs](https://code.claude.com/docs/en/sub-agents)
  and [Equipping agents with Agent Skills, Anthropic Engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- **Per-module context via `AGENTS.md` / `INSIGHTS.md`** read at the working
  directory (matches this repo's Session Protocol) — [Agent teams, Claude Code Docs](https://code.claude.com/docs/en/agent-teams)

Repo-specific decisions layered on top: Implementer on **Sonnet**; **no worktree
isolation** (shared branch, disjoint file ownership); Planner **preloads only the
two architecture skills**; Implementer self-review is **code-writing only**.

The four later agents (`test-writer`, `architecture-reviewer`, `plan-verifier`,
`doc-writer`) were designed the same way — from the repo's own conventions plus
researched practice (researched 2026):

- **test-writer** — the repo's testing philosophy ("typological, not exhaustive";
  the `*.it.test.ts` CI split) — `TESTING.md`; the testcontainers pattern —
  `server/test/helpers/pg.ts`; RTL house style — `AgentCard.test.tsx`; and the
  AI-test-author failure mode ("self-verification loop", green/red-zone,
  run-green-then-mutate-to-red) — [Autonoma: when to trust Claude writing tests](https://getautonoma.com/blog/claude-writing-tests-when-to-trust),
  [Kent C. Dodds: common RTL mistakes](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library),
  [Testing Library query priority](https://testing-library.com/docs/queries/about/),
  [Fastify testing guide](https://fastify.dev/docs/v5.2.x/Guides/Testing/),
  [Testcontainers best practices](https://www.docker.com/blog/testcontainers-best-practices/),
  [AAA pattern](https://automationpanda.com/2020/07/07/arrange-act-assert-a-pattern-for-writing-good-tests/),
  [Kent Beck: Programmer Test Principles](https://medium.com/@kentbeck_7670/programmer-test-principles-d01c064d7934).
- **architecture-reviewer** — mirrors the repo's proven review skeleton
  (`docs/agent-prompts/general-reviewer.md`); Dependency Rule / Ports-&-Adapters —
  [Uncle Bob: The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html),
  [ploeh: Layers, Onions, Ports, Adapters](https://blog.ploeh.dk/2013/12/03/layers-onions-ports-adapters-its-all-the-same/),
  [Hexagonal architecture (Wikipedia)](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software));
  earn-trust / anti-nitpick / false-positive discipline —
  [Augment Code: high-quality AI code review](https://www.augmentcode.com/blog/how-we-built-high-quality-ai-code-review-agent),
  [Graphite: AI review false positives](https://graphite.com/guides/ai-code-review-false-positives).
- **plan-verifier** — Requirements Traceability Matrix —
  [Perforce: how to create a traceability matrix](https://www.perforce.com/blog/alm/how-create-traceability-matrix);
  partial credit + verify actual state over self-report —
  [Anthropic: demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents);
  Acceptance Criteria vs Definition of Done —
  [Nulab](https://nulab.com/learn/software-development/definition-of-done-vs-acceptance-criteria/);
  gap analysis — [Qodo](https://www.qodo.ai/blog/gap-analysis-in-software-testing/).
- **doc-writer** — Diátaxis mode classification —
  [diataxis.fr](https://diataxis.fr/); ADR placement/format —
  [Fowler: Architecture Decision Record](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html);
  code-grounded, hallucination-resistant doc generation —
  [DocAgent (arXiv:2504.08725)](https://arxiv.org/abs/2504.08725); Mermaid C4
  caveat — [Mermaid C4 syntax (experimental)](https://mermaid.js.org/syntax/c4.html).

## Creating a new agent

Mirror `researcher.md`'s format: block-scalar `description` written as a "Use
when…" trigger, comma-separated `tools`, a `model`, and a structured,
section-headed body. Only `name` + `description` are required; skill names in
`skills:` must match a directory in `.claude/skills/` exactly.
