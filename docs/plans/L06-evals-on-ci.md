# Implementation Plan — harness evals on GitHub Actions

**Goal.** Run the `evals/` harness on every PR, scoped to what the PR actually changed:
a changed skill runs that skill's evals; a changed agent runs that agent's evals *plus* the
workflow tier; a changed `CLAUDE.md` runs the workflow tier. All model calls go through
OpenRouter on a cheap model, with the model switchable from the job's parameters.

**Status:** approved 2026-07-12. Decisions taken with the user are recorded in §2.

---

## 1. What already exists (do not rebuild)

| Piece | Where | State |
|---|---|---|
| Change→suite detector | `evals/scripts/ci-detect.mjs` | **Written.** Maps changed files → `skills` / `agents` / `run_workflow` / `skipped_*` GitHub Actions outputs. Artifacts with no evals are reported as SKIP, not failure. |
| OpenRouter backend | `evals/src/runtime/{env,dispatch,run-openrouter}.ts` | **Written.** `EVAL_BACKEND=openrouter` + `EVAL_MODEL` + `OPENROUTER_API_KEY`. |
| LiteLLM translating proxy | `evals/proxy/`, `evals/scripts/litellm-proxy.sh` | **Written.** `pnpm proxy:up|wait|down`. |
| Static gate | `evals/src/skill-quality.ts` (`pnpm eval:quality`) | **Written.** Verified 2026-07-12: 18 skills, 0 failures, exit 0. WARN (no eval file) does not fail — safe as a blocking gate. |

**Missing: only `.github/workflows/evals.yml`.** The README's sketch is not it — it runs
everything unconditionally and never calls `ci-detect.mjs`.

## 2. Decisions

1. **Models, per tier** (revised — see §2a):
   - `skills` (content tier, **no tools at all**) → `deepseek/deepseek-chat`.
   - `agents` + `workflow` (tool tiers, inside the Claude Agent SDK) → `anthropic/claude-haiku-4.5`.

   Cheap OSS models are ruled out on the tool tiers: `deepseek/deepseek-chat` and
   `openai/gpt-4.1-mini` do the work **inline instead of dispatching a subagent**, so those tiers
   would go red for a reason unrelated to the artifact under test.
2. **No LiteLLM proxy in CI.** The proxy exists solely to let a *non-Anthropic* model speak the
   Agent SDK's Anthropic wire protocol. `anthropic/*` slugs are served natively by OpenRouter's
   Anthropic skin, so with Haiku there is nothing to translate. The enabling detail: leave
   `OPENROUTER_BASE_URL` **unset**, and both readers fall back to correct defaults —
   `env.ts` → `https://openrouter.ai/api` (skin, for the SDK) and `run-openrouter.ts:18` →
   `https://openrouter.ai/api/v1` (OpenAI format, for the judge). No Docker in CI at all. The
   proxy stays bundled for local use.
3. **Blocking.** `static` + `skills` + `agents` block the merge. The `workflow` tier is
   `continue-on-error: true` — its `activation` cases assert the model invokes the `Skill` tool,
   and a capable model may do the right thing *without* that tool call.
4. **Fork PRs.** Ignored. Forked PRs get no secrets, so `OPENROUTER_API_KEY` would be empty.

### 2a. Why Haiku on the tool tiers and not `google/gemini-2.5-flash`

The first cut of this plan used Gemini Flash (the one *cheap non-Anthropic* model the README
measured as able to dispatch subagents) plus the LiteLLM proxy. Switching the tool tiers to
`anthropic/claude-haiku-4.5` deletes three problems at once and costs only a little more per token
on suites of 5–6 cases:

- **The proxy disappears** — no Docker image pull per job (the `ghcr.io/berriai/litellm` image did
  not finish pulling in 10 min on a local test), no translating layer to fail, one less moving part.
- **The `maxTurns` calibration risk disappears.** Every case's turn budget was tuned against
  `claude-haiku-4-5`. A weaker model burns more turns, and a session that dies at the cap has its
  interstitial narration judged as the report (`INSIGHTS.md` — this once put the strict agent 50pp
  below its own weakened twin). Same family ⇒ budgets hold; no calibration run needed.
- **Subagent dispatch is the native path**, not a measured "it also manages to".

## 3. Job graph

```
changes ──┬─> static      (no model, always, BLOCKING)
          ├─> skills      (matrix, content tier, deepseek-chat, BLOCKING)
          ├─> agents      (matrix, tool tier,   haiku-4.5,      BLOCKING)
          └─> workflow    (tool tier,           haiku-4.5,      NON-BLOCKING)
```

**No Docker anywhere** — see §2.2. Every job is checkout → pnpm → run.

- **`changes`** — checkout `fetch-depth: 0`, `git diff --name-only <base>...HEAD`, feed
  `CHANGED_FILES` to `ci-detect.mjs`, publish its outputs. ~20 s, no model. Skips forked PRs.
- **`static`** — `pnpm typecheck` + `pnpm eval:quality`. Free; runs even when nothing else does.
- **`skills`** — matrix over `fromJSON(needs.changes.outputs.skills)`. The content tier has no
  tools and reaches OpenRouter through a plain `chat.completions` call (`src/runtime/dispatch.ts`).
- **`agents`** / **`workflow`** — tool tiers, inside the Claude Agent SDK, on an `anthropic/*` slug
  served natively by OpenRouter's Anthropic skin.

## 4. Landmines this plan is written against

1. **No `paths:` filter on `on:`.** A required check with a `paths:` filter leaves every
   non-matching PR stuck on "Expected" forever. Filtering lives in `detect` + per-job `if:`
   instead — a *skipped* job counts as success for branch protection. Cost: ~20 s of runner time
   per PR.
2. **The vitest filter needs a trailing slash.** It is a substring match, so `agents/foo` also
   selects `agents/foo-bar/`. Verified 2026-07-12, while the `architecture-reviewer-lite` A/B twin
   still existed: `vitest list agents/architecture-reviewer` matched **10** tests vs **5** with the
   slash — a one-agent PR silently paid for the twin too. The twin was removed in `62774b1`, so no
   prefix-sharing pair exists today; the slash stays because the bug returns with the next one.
3. **`OPENROUTER_BASE_URL` must stay unset** (see §2.2). It is read by *two* independent places —
   the SDK's base (`env.ts`) and the judge's base (`run-openrouter.ts:18`) — so a stray value
   rebases both onto a proxy that no longer runs in CI.
4. **The workflow tier runs against the live checkout with `bypassPermissions`.** Safe on CI (the
   checkout is disposable) and safe by construction — `WORKFLOW_ALLOWED_TOOLS`
   (`evals/src/config.ts:28`) is a read-only allow-list. Never widen it to make a CI case pass.
5. **`.claude/agents/README.md` is a catalog, not an agent.** It matches the `<name>.md` shape, so
   the raw detector reported `skipped_agents=README` on every catalog edit *and* triggered the whole
   workflow tier. Fixed in `ci-detect.mjs` with a `NOT_AN_ARTIFACT` guard.

## 5. Tasks

| # | Task | Files owned | Status |
|---|---|---|---|
| T1 | Write the workflow: 5 jobs (`changes` → `static` + `skills` + `agents` + `workflow`), per-tier models, no proxy. | `.github/workflows/evals.yml` | done |
| T2 | Model knob: `workflow_dispatch` inputs `skills_model` / `tool_model`, defaulted per tier at job level. | same file | done |
| T3 | Upload `evals/results/` (records.jsonl + outputs/) as an artifact on failure — a red model-backed job is unreadable from the log alone. | same file | done |
| T4 | Detector fixes: `.claude/agents/README.md` inert; an `evals/agents/**` fixture edit no longer drags in the workflow tier (it changes the eval, not the harness). | `evals/scripts/ci-detect.mjs` | done |
| T5 | Replace the outdated CI sketch in the README (it ran every tier unconditionally and ignored the detector). | `evals/README.md` | done |
| T6 | **Real run**: add the repo secret, open a scratch PR, confirm each tier goes green on its target model. | — | **blocked on `OPENROUTER_API_KEY`** |

## 6. Verification

Done (offline):

- `actionlint 1.7.12` — clean.
- Detector exercised against 8 hand-fed `CHANGED_FILES` scenarios, all correct: skill-with-evals,
  skill-without-evals (→ `skipped_skills`, nothing runs), agent-with-evals (→ + workflow tier),
  agent-without-evals (→ `skipped_agents`, workflow tier still runs), `.claude/agents/README.md`
  (→ fully inert), `CLAUDE.md`, eval-fixture-only (→ agent evals, no workflow tier), unrelated code
  (→ nothing).
- vitest filters select exactly 6 / 5 / 5 tests.
- `pnpm typecheck`, `pnpm eval:quality` — green.

Not done — **no model has actually been run**. Needs `OPENROUTER_API_KEY`:

- one green run per tier on its target model (`deepseek/deepseek-chat`, `anthropic/claude-haiku-4.5`);
- confirmation that the judge returns valid JSON on DeepSeek (`parseVerdict` throws if not).
