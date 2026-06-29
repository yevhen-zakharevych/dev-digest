# Output Format

## Finding line format (returned by each agent)

```
[SEVERITY] [skill-name] path/to/file.ts:LINE — one-line description
  Detail: one or two sentences explaining why this is a problem and what to change.
```

Example:
```
[CRITICAL] react-best-practices client/src/components/PrList.tsx:45 — Render factory pattern
  Detail: renderItem() returns JSX — this breaks reconciliation (full unmount/remount each render). Replace with <Item /> component.

[HIGH] onion-architecture server/src/modules/pr/service.ts:23 — Service imports from routes layer
  Detail: service.ts imports ReviewRequest type from routes.ts. Move the type to @devdigest/shared and import from there.

[MEDIUM] next-best-practices client/src/app/dashboard/page.tsx:12 — Missing 'use client'
  Detail: Component calls useState but is in a Server Component file. Add 'use client' at the top.
```

## Final summary — BLOCKED

```
PR Self-Review
══════════════════════════════════════════
Branch:   lesson-02 → main
Changed:  12 files  (7 frontend · 4 backend · 1 contracts)
Agents:   A Frontend · B Backend · D Contracts · E Security
──────────────────────────────────────────

[CRITICAL] react-best-practices  client/src/components/PrList.tsx:45
  Render factory pattern: renderItem() returns JSX. Use <Item /> component.

[HIGH] onion-architecture  server/src/modules/pr/service.ts:23
  Service imports routes.ts — violates inward-only dependency rule.

[MEDIUM] next-best-practices  client/src/app/dashboard/page.tsx:12
  Missing 'use client' directive for component using useState.

──────────────────────────────────────────
BLOCKED — 1 critical issue must be fixed before opening a PR.
Run /pr-self-review again after fixing to clear the gate.
```

## Final summary — WARNING (no critical, has high)

```
PR Self-Review
══════════════════════════════════════════
Branch:   lesson-02 → main
Changed:  8 files  (5 frontend · 3 backend)
──────────────────────────────────────────

[HIGH] onion-architecture  server/src/modules/pr/service.ts:23
  Service imports routes.ts — violates inward-only dependency rule.

[MEDIUM] next-best-practices  client/src/app/dashboard/page.tsx:12
  Missing 'use client' directive.

──────────────────────────────────────────
WARNING — no critical issues, but 1 high-severity finding above.
Review passed the gate. You may open a PR, but consider fixing HIGH issues first.
```

## Final summary — OK

```
PR Self-Review
══════════════════════════════════════════
Branch:   lesson-02 → main
Changed:  5 files  (3 frontend · 2 backend)
──────────────────────────────────────────
No issues found.

Agents run: A Frontend (react, next, arch) · E Security
Checked: component design, hooks, RSC boundaries, OWASP Top 10

Self-review passed. Safe to open a PR.
```
