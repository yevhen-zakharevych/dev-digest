---
name: engineering-insights
description: Captures non-obvious engineering insights (patterns that worked, antipatterns, dependency quirks, recurring errors, open questions) discovered during a coding session. Use this skill when you notice a finding that would not be obvious to someone reading the code cold — and again at the end of a task to record any uncaptured lessons. Writes append-only to the INSIGHTS.md of the module touched by the work (root INSIGHTS.md for cross-module).
---

# engineering-insights

When you encounter a non-obvious finding while working — or at task wrap-up — append it to the right `INSIGHTS.md`.

**Routing.** Pick the file by which paths the task touched:
`client/**` → `client/INSIGHTS.md`; `server/**` → `server/INSIGHTS.md`;
`reviewer-core/**` → `reviewer-core/INSIGHTS.md`;
`e2e/**` → `e2e/INSIGHTS.md`; otherwise → root `INSIGHTS.md`.

**Section.** Choose one: `What Works` / `What Doesn't Work` / `Codebase Patterns` / `Tool & Library Notes` / `Recurring Errors & Fixes` / `Session Notes` (datestamped `### YYYY-MM-DD — title`) / `Open Questions`. Append; never edit existing entries.

**Quality test.** Each entry must be actionable cold and cite `file:line`. If it would be obvious to anyone reading the code, do not write it.
