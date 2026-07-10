# specs — cross-module specifications

This top-level `specs/` directory holds Spec-Driven Development (SDD) specifications
that span **two or more** modules, plus the repo-wide contracts and proposals below.
Single-module specs live next to their module instead — keep a spec as close to the
code it governs as its scope allows.

| Spec scope | Location |
|------------|----------|
| `server` only | `server/specs/` |
| `client` only | `client/specs/` |
| `reviewer-core` only | `reviewer-core/specs/` |
| **cross-module (≥ 2 modules)** | `specs/` (here) |

**`e2e` never gets its own spec.** Despite the name, `e2e/specs/` holds browser flow
fixtures (`*.flow.json`), not specifications — see its `README.md`. A browser flow always
verifies a feature owned by another module, so an e2e concern is cross-module by
construction: spec it here and describe the flow in the spec.

## What a spec is

Specs are authored by the **`spec-creator`** agent (`.claude/agents/spec-creator.md`).

A spec describes **what** a feature must do and **why** — the problem, goals /
non-goals, user stories, assumptions, EARS acceptance criteria, edge cases, workflows,
cross-module interactions, contracts, and how it rolls out to data that already exists.
It deliberately stops short of **how** to implement it (file-by-file tasks, layers, code)
— that is the `implementation-planner` agent's Development Plan, which lands in
`docs/plans/`.

Any feature that reaches a model call also states its **LLM usage & determinism**: how
many calls per what unit, what the user sees when the model fails, and whether the same
input must yield the same output. A model call costs money per token, can fail, and need
not repeat itself — three properties ordinary code does not have, and a spec that omits
them hands all three surprises to whoever implements it.

```
spec-creator → spec (WHAT/WHY) → implementation-planner → plan (HOW)
             → implementer → test-writer → plan-verifier
```

The `AC-N` acceptance-criterion ids a spec assigns are the identifier that survives every
hop: the planner cites them in its `Source` column, and `plan-verifier` traces them to the
code that was actually written. An unnumbered requirement is one nobody can verify.

### What a spec may contain — and may not

A spec may carry diagrams, workflows, service-to-service communication, and contracts.
It may not carry the implementation of any of them. The test: **could two competent
engineers satisfy this statement with different code?** If yes, it belongs in the spec.

Naming a *module* is fine ("the client requests this from the server"). Naming a *file,
function, table, constant, or library* is not — a contract states the fields crossing a
boundary, their direction, optionality, valid values, and the failure shape, never the
Zod schema or table that carries them.

## Conventions

- **File name:** `YYYY-MM-DD-<kebab-feature-name>.md`
- **Spec ID** (in the header line): `SPEC-YYYY-MM-DD-<kebab-feature-name>`
- **Status lifecycle:** `draft` → `approved` → `implemented`. `spec-creator` always
  writes `draft` and never advances it — promoting a spec is a human call.
- **Language:** specs are written in English, aligned with the rest of the repo docs.

Date + slug rather than a sequential `SPEC-NN`: a counter has no conflict-free way to
allocate the next number across branches — two branches both read `SPEC-04` as the max,
both write `SPEC-05`, and the collision surfaces only at merge.

A spec that replaces an earlier decision links it via the `Supersedes:` header line. The
superseded spec's own `Status:` is flipped by a human, not by the agent.

## Also in this directory

- `contracts/<name>.md` — repo-wide contracts that are not tied to one feature
  (e.g. SSE event shape, finding lifecycle).
- `rfc/NNNN-<slug>.md` — proposals argued before a spec is written.

Neither is created by `spec-creator`; both are hand-authored.
