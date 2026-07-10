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

### 4. Deterministic checks (run these yourself, not via sub-agents)

These three need no model judgement — they are `git`/shell facts. Run them while the
agents from step 3 are still working.

#### 4.1 Vendored-contract mirror check

`@devdigest/shared` is dual-vendored: `server/src/vendor/shared/**` is canonical,
`client/src/vendor/shared/**` is a physical mirror. A one-sided edit typechecks on both
sides independently and then fails at runtime when Zod rejects the wire payload
(`INSIGHTS.md:48`).

**Never `diff -r` the two trees.** They are not byte-identical today and are not meant to
be: docstrings differ (`INSIGHTS.md:48`), and `adapters.ts` legitimately diverges — the
server copy carries `sync`/`diffNameOnly` that the client's does not (`INSIGHTS.md:66`).
A whole-file diff reports CRITICAL on every PR, which is how a gate gets switched off.
Compare **only what this diff added**:

```bash
# 1. Which vendored files does this PR touch?
git diff main...HEAD --name-only -- 'server/src/vendor/shared' 'client/src/vendor/shared'
```

For each touched file, its counterpart is the same path with the leading `server/` and
`client/` swapped. Then:

- **Counterpart absent from the list** → `CRITICAL`: one-sided vendored edit. Name both
  paths and say which side is missing the mirror.
- **Both present** → compare the added lines, ignoring comments and whitespace:

  ```bash
  added() { git diff main...HEAD -- "$1" \
    | sed -n 's/^+\([^+].*\)/\1/p' \
    | grep -vE '^[[:space:]]*(//|/\*|\*)' \
    | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//'; }
  diff <(added server/src/vendor/shared/<f>) <(added client/src/vendor/shared/<f>)
  ```

  Non-empty output → `CRITICAL`: the mirrored edit diverges. Quote the differing lines.

If the PR touches no vendored file, this check emits nothing.

#### 4.2 Dependency audit

Run **only when a lock file is in the diff.** A changed `package.json` alone does not
warrant it — bumping a script name introduces no vulnerability, and auditing on every
`package.json` touch reports the tree's pre-existing advisories, which the confidence
filter in [severity-gate.md](severity-gate.md) forbids flagging.

The package manager differs per package — this repo is pnpm except `reviewer-core/` and
`e2e/` (root `CLAUDE.md`: "pnpm only", but those two carry a `package-lock.json`):

```bash
# client/pnpm-lock.yaml, server/pnpm-lock.yaml, mcp-server/pnpm-lock.yaml changed:
cd <pkg> && pnpm audit --audit-level high

# reviewer-core/package-lock.json, e2e/package-lock.json changed:
cd <pkg> && npm audit --audit-level=high
```

Never run `npm audit` in a pnpm package — there is no `package-lock.json` there and the
command fails. Report one `HIGH` per advisory, not CRITICAL: an advisory is almost always
pre-existing in a transitive dependency, and blocking the PR on it punishes whoever
happened to touch the lock file. HIGH surfaces it without stopping the push.

#### 4.3 Test-coverage check

For every **source** file in the diff, check whether a test file was also changed.

```bash
git diff main...HEAD --numstat --diff-filter=AM -- '*.ts' '*.tsx'
```

Skip a file when any of these hold — none of them carry behaviour worth a test:

- it is itself a test (`*.test.ts`, `*.test.tsx`, `*.it.test.ts`, `*.spec.ts`)
- it sits under `vendor/`, `types/`, `constants/`, `messages/`, `i18n/`, `db/migrations/`
- it is a Next.js framework file (`layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`)
- fewer than 20 lines changed in it (added + deleted, from `--numstat`)

A file counts as covered when the diff also touches **any** test file in its module. Then:

- source file **modified** (`M`), no test file changed anywhere in that module → `HIGH`
- source file **added** (`A`), no test file changed anywhere in that module → `MEDIUM`

This is a reminder, not a blocker — neither severity stops the gate.

### 5. Aggregate and apply the severity gate

Read [severity-gate.md](severity-gate.md). Apply the rules to the collected findings —
the sub-agents' findings from step 3 **and** the deterministic ones from step 4 together.

### 6. Write sentinel or error

**If no CRITICAL findings:**
```bash
echo "$(git rev-parse HEAD)" > .claude/.review-passed
```
Print the success summary from [output-format.md](output-format.md).

**If CRITICAL findings exist:**
Do NOT write the sentinel. Print the blocked summary and stop. Do not proceed to `gh pr create`.

### 7. Notes

- Only analyze lines present in the diff — do not flag pre-existing issues in unchanged lines.
- If a file appears in the diff but is in `e2e/`, skip specialized skill review; apply only `security` agent.
- Config files (`*.json`, `*.yaml`, `*.sh`, `docker-compose.yml`) go to `security` agent only.
- The sentinel file `.claude/.review-passed` is gitignored — it is local state only.
- **Escape hatch.** A line carrying `// pr-self-review-ignore: <reason>` (or `#` for shell
  /yaml) suppresses findings on that line and the next one. Honour it, and list every
  suppression used in the final summary so it stays visible. A reason is mandatory — a
  bare `pr-self-review-ignore` with no text is itself a `MEDIUM` finding. This exists so a
  single false positive costs one annotated line, not the whole gate being disabled.
