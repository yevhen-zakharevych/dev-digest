# reviewer-core — map (`@devdigest/reviewer-core`)

Pure review engine: **diff → prompt → LLM → grounded findings**. No DB,
no GitHub, no FS. The only side effect is an LLM call through an injected
`LLMProvider`. See `README.md` for the pipeline diagram.

## Stack notes (non-default)

- Pure TypeScript, no build emit (`build` = `tsc --noEmit`)
- Consumed as TS source by `server/` via tsconfig path alias
- Vitest with hermetic units; LLM stubbed in tests
- Zod → JSON Schema → parse-with-repair for structured output

## Module map

- `src/index.ts`        — public API surface (everything re-exported here)
- `src/prompt.ts`       — `assemblePrompt`, `wrapUntrusted`, `INJECTION_GUARD`
- `src/grounding.ts`    — `groundFindings`, `groundingSummary` (mandatory gate)
- `src/llm/`            — `LLMProvider` interface + `openrouter.ts` + `structured.ts`
- `src/output/`         — `toJsonSchema`, `extractJson`, `parseWithRepair`
- `src/review/`         — `run.ts` (single-pass orchestrator), `reduce` (map-reduce)

## Conventions (non-default for this module)

- **Pure**: no `fs`, no `fetch`, no `process.env` reads. Anything I/O-shaped
  is injected. This makes the engine mock-testable and CI-runnable later.
- Every public symbol re-exports from `src/index.ts`. Consumers never reach
  into subpaths.
- Contracts (`Review`, `Finding`, `Verdict`, …) come from `@devdigest/shared`;
  don't redefine here.
- Optional prompt slots (`skills`, `memory`, `specs`, `callers`) are accepted
  but may be omitted — `assemblePrompt` silently skips empty sections. This
  is how lesson modules (L02, L05, L07) extend without forking.

## Gotchas

- **Grounding is mandatory and non-negotiable.** A finding that doesn't cite
  a real diff line is dropped. The score is RECOMPUTED from survivors —
  the model's self-reported score is ignored by design.
- **Injection defense is ONE shared rule**, not keyword scanning. The
  `INJECTION_GUARD` appended by `assemblePrompt` tells the model untrusted
  content is data, never instructions. Don't add denylists/regex — they
  catch one phrasing and miss the rest.
- `wrapUntrusted()` fences ALL untrusted inputs (diff, PR body, README,
  comments). If you add a new input that can come from a PR author, it
  MUST go through `wrapUntrusted`.
- The package emits no JS. Tools that expect `dist/` will not work — every
  consumer must read the TS source.
- `reduce()` / map-reduce path exists but isn't on by default; the starter
  runs single-pass. Course lesson L07 turns it on.

## Read when…

- …editing the prompt template     → `src/prompt.ts` + `README.md` § "Pipeline"
- …changing what survives grounding → `src/grounding.ts` + `INSIGHTS.md`
- …new LLM provider                → `src/llm/` (implement `LLMProvider`)
- …adding a new prompt slot for a lesson → `src/prompt.ts` (`assemblePrompt`)
- …structured-output failures      → `src/output/parseWithRepair.ts`
- …consumer-side wiring            → `../server/AGENTS.md` (it's the consumer)
- …past pipeline gotcha            → `INSIGHTS.md`

## Module commands

- typecheck (== build): `npm run typecheck`
- test:                 `npm test`     (vitest, hermetic)

## Sibling links

- Up:           `../AGENTS.md`
- Consumed by:  `../server/AGENTS.md` (path alias; TS source)
- Contracts:    `../server/src/vendor/shared/` (the `@devdigest/shared` source)
