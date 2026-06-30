---
name: pr-self-review
description: "Local pre-PR gate. Runs before opening a pull request to catch CRITICAL issues across frontend and backend. Routes changed files to the right specialized skills (react, next.js, onion-architecture, fastify, drizzle, security, zod, typescript). Blocks merge recommendation if any CRITICAL finding is found. Trigger: /pr-self-review or automatically via pre-push hook."
metadata:
  tags: review, pre-pr, quality-gate, frontend, backend, architecture, security
---

## When to use

Run this skill:
- Before `gh pr create` (the pre-push hook runs it automatically via sentinel check)
- Manually with `/pr-self-review` at any point during development
- After a large refactor before committing

Do NOT use this as a replacement for CI — it does not run tests, type-check, or build.

## Steps

### 1. Gather the diff

```bash
git diff main...HEAD --name-only       # list of changed files
git diff main...HEAD                   # full diff content
git log main...HEAD --oneline          # commit context
git rev-parse HEAD                     # current SHA (for sentinel)
```

If `git diff main...HEAD --name-only` returns empty, inform the user there are no changes vs `main` and stop.

### 2. Categorize changed files

Read [routing.md](routing.md) for the full path → skill mapping table.

Quickly bucket every changed file into one or more categories:
- `frontend` — `client/**`
- `backend-arch` — `server/src/modules/**`, `server/src/adapters/**`, `server/src/platform/**`, `reviewer-core/**`
- `database` — `server/src/db/**`, any file matching `*repository.ts`, `*schema.ts`, `*migration*`
- `contracts` — `server/src/vendor/shared/**`
- `typescript` — any `.ts` or `.tsx` file (overlaps with all above)
- `security` — all files

### 3. Launch parallel review agents

Spawn only agents where at least one changed file falls in their category.
Pass each agent: its assigned skills (already loaded via routing.md), the relevant slice of the diff, and the severity rules from [severity-gate.md](severity-gate.md).

| Agent | Skills to load | Files scope |
|---|---|---|
| **A – Frontend** | `react-best-practices`, `next-best-practices`, `frontend-architecture` | `client/**` diff only |
| **B – Backend Architecture** | `onion-architecture`, `fastify-best-practices` | `server/src/modules/**`, `server/src/adapters/**`, `server/src/platform/**`, `reviewer-core/**` diff only |
| **C – Database** | `drizzle-orm-patterns`, `postgresql-table-design` | `server/src/db/**`, `*repository.ts`, `*schema.ts` diff only |
| **D – Contracts & Types** | `zod`, `typescript-expert` | `server/src/vendor/shared/**` + all `.ts`/`.tsx` diff |
| **E – Security** | `security` | full diff |

Each agent must return findings in the exact format specified in [output-format.md](output-format.md): one finding per line with `[SEVERITY] [skill-name] file:line — description`.

### 4. Aggregate and apply the severity gate

Read [severity-gate.md](severity-gate.md). Apply the rules to the collected findings.

### 5. Write sentinel or error

**If no CRITICAL findings:**
```bash
echo "$(git rev-parse HEAD)" > .claude/.review-passed
```
Print the success summary from [output-format.md](output-format.md).

**If CRITICAL findings exist:**
Do NOT write the sentinel. Print the blocked summary and stop. Do not proceed to `gh pr create`.

### 6. Notes

- Only analyze lines present in the diff — do not flag pre-existing issues in unchanged lines.
- If a file appears in the diff but is in `e2e/`, skip specialized skill review; apply only `security` agent.
- Config files (`*.json`, `*.yaml`, `*.sh`, `docker-compose.yml`) go to `security` agent only.
- The sentinel file `.claude/.review-passed` is gitignored — it is local state only.
