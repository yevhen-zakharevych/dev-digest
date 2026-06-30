# File Routing Table

Maps changed file path patterns to the skills that should review them.
A single file can match multiple rows — all matching skills apply.

## Path → Agent mapping

| Path pattern | Agent | Skills |
|---|---|---|
| `client/**/*.tsx` | A – Frontend | react-best-practices, next-best-practices, frontend-architecture |
| `client/**/*.ts` | A – Frontend | next-best-practices, frontend-architecture, typescript-expert |
| `client/**/*.css` | A – Frontend | frontend-architecture |
| `server/src/modules/**/routes.ts` | B – Backend Arch | onion-architecture, fastify-best-practices |
| `server/src/modules/**/service.ts` | B – Backend Arch | onion-architecture |
| `server/src/modules/**/repository.ts` | B, C – Backend + DB | onion-architecture, drizzle-orm-patterns |
| `server/src/adapters/**` | B – Backend Arch | onion-architecture, fastify-best-practices |
| `server/src/platform/container.ts` | B – Backend Arch | onion-architecture |
| `reviewer-core/**` | B – Backend Arch | onion-architecture |
| `server/src/db/schema.ts` | C – Database | drizzle-orm-patterns, postgresql-table-design |
| `server/src/db/migrations/**` | C – Database | drizzle-orm-patterns, postgresql-table-design |
| `server/src/vendor/shared/**` | D – Contracts | zod, typescript-expert |
| `**/*.ts` (not already matched above) | D – Contracts | typescript-expert |
| `**/*.tsx` (not already matched above) | D – Contracts | typescript-expert |
| all changed files | E – Security | security |

## Skip list

The following paths are excluded from skill-based review (security agent still runs):
- `e2e/**`
- `**/*.test.ts`, `**/*.it.test.ts`, `**/*.spec.ts`
- `**/*.md`
- `**/node_modules/**`
- `**/.env*`

## Skill load order within an agent

When an agent has multiple skills, read them in this order so more specific rules override general ones:
1. Architecture skill (`onion-architecture`)
2. Framework skill (`fastify-best-practices`, `react-best-practices`, `next-best-practices`)
3. Data skill (`drizzle-orm-patterns`, `postgresql-table-design`)
4. Contract skill (`zod`)
5. Language skill (`typescript-expert`)
6. Security (`security`) — always last, reads the other findings first to avoid duplication
