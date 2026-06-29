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
