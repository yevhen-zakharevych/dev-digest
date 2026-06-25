# server/docs

Deep how-tos and design notes for the API. Anything that's too detailed
for `../README.md` (which is the public face) but too generic for
`../INSIGHTS.md` (which is incident-driven).

Suggested topics:

- `db-migrations.md` — how to add/run/rollback a migration
- `adapters.md` — how to add a new adapter behind the DI container
- `testing.md` — `*.it.test.ts` split, testcontainers setup
- `error-envelope.md` — the structured error format used by the handler
