---
name: dependency-checker
description: "Audits this repo's dependencies — both external npm packages and internal cross-package links — and emits a structured report: a Mermaid dependency graph, an installed-size breakdown, findings ranked into P0/P1/P2/Info tiers, and a prioritized summary. Use when asked to check/audit/analyze dependencies, find unused or duplicated packages, investigate bundle or node_modules size, review version drift across packages, or map how client/server/reviewer-core/e2e/mcp-server/evals depend on each other. Trigger terms: dependency check, dependency audit, package.json, node_modules size, unused dependency, version drift, duplicate dependency, dependency graph, bundle size, pnpm audit, npm audit, lockfile."
metadata:
  tags: dependencies, audit, npm, pnpm, size, graph, architecture, reporting
---

## When to use

Use this skill when the request is about **what this repo depends on** — external npm packages,
internal cross-package links, or the weight of either:

- "Check / audit / analyze our dependencies"
- "What's making `node_modules` (or the bundle) so big?"
- "Are there unused or duplicated packages?"
- "Do we have version drift across packages?"
- "Draw a dependency graph of the repo"
- Reviewing a diff that touches any `package.json`, lockfile, or `tsconfig.json` `paths` block

Do **not** use it for runtime performance, for dead application code (that's not a dependency), or
for choosing a new library from scratch.

## The one thing to get right first

This repo is **NOT a workspace**. There is no `workspace:*` protocol, no `pnpm-workspace.yaml`, no
root `package.json`. Six independent packages each own their `package.json` **and their own
lockfile**, and they share code through **TypeScript path aliases**, not through npm.

That single fact drives everything below: there are **two kinds of dependency here**, and a report
that blurs them is wrong no matter how pretty its graph is.

| Kind | Mechanism | Where declared | How you find it |
|------|-----------|----------------|-----------------|
| **External** | npm package, installed into `node_modules` | `<pkg>/package.json` | read the manifest + the lockfile |
| **Internal** | TypeScript path alias, consumed as **source** | `<pkg>/tsconfig.json` → `compilerOptions.paths` | read the `paths` block + grep the imports |

Never claim these packages are linked by `workspace:*` or pnpm workspaces. They are not.

Read [references/repo-map.md](references/repo-map.md) before the first command — it lists the six
packages, which package manager each one actually takes, and the landmines that will otherwise
produce a confidently wrong report.

## The pipeline

Run these four phases in order. Do not skip phase 1 — a report that silently analyzed four of six
packages is worse than one that says which two it skipped.

### Phase 1 — Scope

**This phase is never optional and its output is never omitted.** Whatever the question was — a
full audit, "what's our biggest package," or a single "how do I check for CVEs" — the answer opens
with a Scope table. It is the only thing that tells the reader what your answer left out, and an
answer that hides its own blind spots is worse than no answer.

1. List the packages present (`server`, `client`, `reviewer-core`, `e2e`, `mcp-server`, `evals`).
2. For each, detect the package manager **from the lockfile on disk**, not from convention:
   `pnpm-lock.yaml` → pnpm; `package-lock.json` → npm. Getting this wrong makes every subsequent
   command fail (see [references/repo-map.md](references/repo-map.md)).
3. For each, record whether `node_modules` is **installed**, package by package. This column is
   mandatory. A package without it cannot be size-analyzed or audited as installed — say which
   package, by name. On this tree that is usually `e2e` **and only `e2e`**; do not generalize the
   gap to its npm sibling `reviewer-core`, which is installed, or you invent a chore for a package
   that is already fine.

The table is four columns and costs three lines of output. There is no question narrow enough to
justify skipping it.

### Phase 2 — Collect

Gather the raw facts with the commands in [references/commands.md](references/commands.md). Every
command there has been run against this tree. Collect, in this order:

1. **Manifests** — declared `dependencies` / `devDependencies` per package.
2. **Internal edges** — each `tsconfig.json` `paths` block, plus a grep for imports that cross a
   package boundary.
3. **Sizes** — installed size per dependency, and the totals per package.
4. **Drift** — the same dependency declared at different versions in different packages.
5. **Unused** — declared in a manifest but never imported in that package's source.
6. **Advisories** — `pnpm audit` or `npm audit`, chosen per the lockfile from phase 1.

### Phase 3 — Analyze

Turn facts into findings. A fact ("`mermaid` is 75M") is not a finding; a finding says what is
wrong, what it costs, and what to do. Assign each one a tier using the rules in
[Severity tiers](#severity-tiers) below — and calibrate it against the clean tree before you commit
to it.

### Phase 4 — Report

Emit the report in exactly the structure below. Fill the skeleton in
[references/report-template.md](references/report-template.md).

## Report structure (required)

The report has **five sections, in this order**, with these headings. This structure is the
skill's contract — a report missing a section is incomplete, even if its content is correct.

### 1. `## Scope`

What was analyzed and what was not. Name every package, its package manager, and whether its
`node_modules` was available. One table, no prose padding.

**Scope is the one section that survives every abbreviation.** The other four may be dropped when
the question is narrow enough not to warrant them; this one may not.

### 2. `## Dependency Graph`

A Mermaid ` ```mermaid ` fenced block using `flowchart`, showing how the packages depend on each
other. Requirements:

- **Internal edges** (path aliases) and **external edges** (npm) must be visually distinguishable —
  use a solid arrow `-->` for internal source-level links and a dotted arrow `-.->` for heavy
  external packages, and label each edge with the mechanism (`@devdigest/shared`, `npm`).
- Show only the external dependencies that carry weight or a finding. A node per npm package turns
  the graph into noise; the graph exists to make the *shape* legible, not to re-list the manifest.
- Any boundary violation you found (phase 2, step 2) gets a marked edge — that is the single most
  valuable thing the graph can show.

### 3. `## Size Breakdown`

A table, not a sentence. "The dependencies are quite large" is not a size breakdown.

| Package | Dependency | Installed size | Note |
|---------|-----------|----------------|------|

Plus a per-package total row, and a repo total. Sort descending by size — the reader's first
question is always "what's the biggest thing," and the table should answer it in the first row.
Report installed size on disk; if you also have a bundle-size figure, label it as such and never
conflate the two (a 75M `node_modules` entry may ship 40kB to the browser).

### 4. `## Findings & Priorities`

Every finding, grouped under an explicit tier heading (`### P0`, `### P1`, `### P2`, `### Info`).
An unranked bullet list is a failure of this section — ranking *is* the deliverable.

Each finding uses this shape:

```
**[P1-2] `zod` is declared at three different versions across packages.**
- Evidence: server/package.json:31 `^3.25.76`, client/package.json:24 `^3.24.1`, reviewer-core/package.json:12 `^3.25.76`
- Impact: two Zod type identities can meet at a shared contract boundary and fail to unify (see INSIGHTS.md).
- Fix: align all three on `^3.25.76`; re-run each package's typecheck.
```

Non-negotiable: **every finding names a specific package, dependency, or `file:line`.** A finding
that reads "consider optimizing dependencies" or "review unused packages" is not a finding — delete
it. If you cannot name the thing, you have not finished the analysis.

### 5. `## Summary`

Three to five concrete, actionable takeaways, **ordered by priority** (highest tier first). Each
one is a sentence a developer can act on without scrolling back up: what to do, to which package,
and why it is first. Not a restatement of the tiers — the decision, distilled.

## Severity tiers

| Tier | Means | Examples in this repo |
|------|-------|-----------------------|
| **P0** | Breaks the build or causes silent runtime failure. Fix before merge. | A one-sided edit to a dual-vendored contract; a `zod` `paths` alias added to a new package (`tsc` OOMs); an import that bypasses a package's public entry point and reaches into its internals. |
| **P1** | Real risk, no breakage yet. Fix this sprint. | Version drift on a dependency that crosses a package boundary; a dependency declared but never imported; a HIGH/CRITICAL advisory **introduced by the current change**. |
| **P2** | Hygiene and weight. Fix when convenient. | A heavy dependency with a materially lighter alternative; a build-only tool declared in `dependencies` instead of `devDependencies`. |
| **Info** | True, worth knowing, **not actionable by this change**. | The advisories already standing on the clean tree; a dependency that is simply large but load-bearing (`next`, `mermaid`). |

### The calibration rule

**Before assigning a tier, ask: is this already red on a clean tree?**

If the finding is true on `main` and the current change did not introduce it, it is **Info** —
at most P2. It is never P0.

This is not pedantry, it is the difference between a gate people keep and a gate people switch off.
`client/` already reports `11 vulnerabilities — 1 low | 7 moderate | 2 high | 1 critical`, all
transitive through `@vitejs/plugin-react > vite`, on a completely clean checkout. A tiering that
calls those P0 blocks every PR in the repo on issues its author did not cause, and gets disabled
within a week. Report them as Info, name them, move on.

## Hard rules

1. **Never run `npm audit` in a pnpm package.** `server`, `client`, `mcp-server`, and `evals` carry
   only `pnpm-lock.yaml`; `npm audit` there exits `ENOLOCK` and produces nothing. `reviewer-core`
   and `e2e` carry `package-lock.json` and take `npm audit`. Branch on the lockfile, every time.
2. **Never say `workspace:*` or "monorepo/pnpm workspace."** The packages are linked by tsconfig
   path aliases, not by npm.
3. **Propose; do not execute.** Removing a dependency, bumping a version, and editing a lockfile are
   the user's calls. Present them as recommendations with the exact command to run — never report a
   removal as already done.
4. **An "unused" dependency needs proof.** Grep the package's own source for the import before
   calling it unused, and say where you looked. A dependency can be used by a config file, a script,
   or a type-only import that a naive grep misses.
5. **Report what you could not check.** A package whose `node_modules` is absent, an advisory feed
   that failed, a size you could not measure — say so, and name the **exact** package it applies to.
   Do not blur it ("install `node_modules` for reviewer-core and e2e" is wrong when only `e2e` is
   missing — it manufactures a chore for a package that is already fine). Silence reads as "clean,"
   and that is the one lie the report must not tell.
6. **A narrow question still gets phase 1.** When asked only "how do I audit for vulnerabilities"
   or "what's the biggest package," you may skip the full five-section report — but never skip
   Scope. State which packages you covered, which package manager each takes, and what you could
   not reach. The answer is unusable without it, because the reader cannot tell what it left out.

## Reference files

- [references/repo-map.md](references/repo-map.md) — the six packages, their package managers, the
  path-alias graph, and the known landmines. **Read this first.**
- [references/commands.md](references/commands.md) — the data-gathering commands, each one verified
  against this tree, branching correctly on pnpm vs npm.
- [references/report-template.md](references/report-template.md) — the fill-in-the-blanks report
  skeleton.
