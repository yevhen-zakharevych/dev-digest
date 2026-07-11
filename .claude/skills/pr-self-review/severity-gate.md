# Severity Gate

## Severity definitions

Each finding from an agent must carry one of these severities:

| Severity | Meaning | Source |
|---|---|---|
| **CRITICAL** | Will cause a bug, broken architecture contract, or security vulnerability | Explicitly tagged CRITICAL in the skill rules |
| **HIGH** | Will cause performance, maintainability, or scaling problems | Explicitly tagged HIGH in the skill rules |
| **MEDIUM** | Hurts DX or code quality but does not break anything | Explicitly tagged MEDIUM in the skill rules |

When a skill rule does not carry a tag, agents must assign severity based on this hierarchy:
- Architecture/layer violations → CRITICAL
- Security vulnerabilities with confirmed attacker-controlled input → CRITICAL
- Render factories, key misuse, broken reconciliation → CRITICAL (react-best-practices)
- Data loss risk in migrations → CRITICAL (drizzle/postgres)
- Everything else → HIGH or MEDIUM based on the skill's own guidance

## Severities for the deterministic checks (SKILL.md step 4)

These are fixed — do not re-judge them:

| Check | Condition | Severity | Why not higher / lower |
|---|---|---|---|
| Contract mirror | vendored file changed on one side only | **CRITICAL** | Runtime Zod drift; typecheck passes on both sides and hides it (`INSIGHTS.md:48`) |
| Contract mirror | both sides changed, added lines diverge | **CRITICAL** | Same failure, one step later |
| Dependency audit | `high`/`critical` advisory, lock file in diff | **HIGH** | Almost always pre-existing and transitive — blocking punishes whoever touched the lock file. Verified 2026-07-10: `client/` already carries 1 critical + 2 high advisories via `@vitejs/plugin-react > vite`. At CRITICAL this gate would be permanently shut. |
| Test coverage | source file **modified**, no test touched in module | **HIGH** | A reminder, not a defect |
| Test coverage | source file **added**, no test touched in module | **MEDIUM** | New code, but the plan may schedule its tests separately |
| Escape hatch | `pr-self-review-ignore` with no reason given | **MEDIUM** | Suppression without a stated reason |

Only the contract-mirror check can block the gate, and only when **this diff** created the
divergence. The two vendored trees are not byte-identical at rest — never compare them
whole (see SKILL.md 4.1).

## Gate rules

```
CRITICAL count > 0
  → DO NOT write sentinel
  → Print BLOCKED summary
  → Do not proceed to gh pr create
  → Exit

HIGH count > 0, CRITICAL count = 0
  → Write sentinel (review passed the gate)
  → Print WARNING summary
  → Claude may proceed to gh pr create

MEDIUM only, or no findings
  → Write sentinel
  → Print OK summary
  → Claude may proceed to gh pr create
```

## Confidence filter

Before escalating a finding to the output, apply the same confidence bar as /code-review:

- Only report findings where the agent is ≥ 75% confident the issue is real and present in the diff.
- Do NOT flag: pre-existing issues in unchanged lines, linter/type errors (CI catches those), pedantic style, hypothetical future issues.
- If two agents report the same issue (e.g., onion-architecture and fastify-best-practices both flag the same import), deduplicate — keep the one from the more specific skill.
- Respect `// pr-self-review-ignore: <reason>` on the annotated line and the one after it.
  The confidence filter does not apply to the step-4 deterministic checks — they are facts,
  not judgements — but the escape hatch does.
