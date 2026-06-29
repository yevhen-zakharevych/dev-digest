# e2e — map (`@devdigest/e2e`)

Deterministic browser end-to-end flows driven by Vercel **agent-browser**
(Rust + CDP). **No Playwright, no LLM, no API key.** See `README.md` for
the spec format and coverage table.

## Stack notes (non-default)

- `agent-browser` CLI (native, NOT a framework). Install once:
  `npm i -g agent-browser && agent-browser install`
- Flows are JSON in `specs/NN-name.flow.json` — list of CLI commands.
- `run.ts` is a thin runner that streams steps in one shared session.
- No test framework: a non-zero exit from a step fails the flow.

## Module map

- `specs/NN-name.flow.json` — flow definitions (numbered for order)
- `run.ts`                  — the runner (substitutes `{BASE}`, drives `agent-browser`)
- `agent-browser.json`      — agent-browser CLI config
- `package.json`            — `test` + `e2e:hermetic` scripts
- `test-results/`           — failure screenshots (git-ignored)

## Conventions (non-default for this module)

- **Deterministic locators only.** Use `wait --url`, `wait --text`,
  `find role|text|label`. NEVER the AI `chat` command — it would make
  runs flaky and require keys.
- `wait --text` / `wait --url` ARE the assertions (they time out and exit
  non-zero on failure). Don't add a separate assert layer.
- Optional `"assert": { "stdoutIncludes": "…" }` on a step is the only
  custom check we add on top of agent-browser's own exit code.
- Flows target **seeded read-only data** (`acme/payments-api`, PR #482,
  built-in agents). NEVER write a flow that triggers a model call.
- `{BASE}` placeholder is replaced with `E2E_BASE_URL`.

## Gotchas

- **Precondition: freshly-seeded DB.** Flow `02` follows the home redirect
  to the FIRST repo — assumes the seeded demo repo is the only one. Your
  local dev DB usually has imported repos → flows 02/04/05 land on the
  wrong repo and fail. **Use the hermetic runner.**
- ⚠️ **NEVER `docker compose down -v` to "reset" your dev DB** — `-v`
  deletes `devdigest_pgdata` along with every real repo you imported.
- Hermetic stack runs on alternate ports: Postgres :5433, API :3101,
  web :3100. Safe to run alongside your dev stack (`scripts/dev.sh`).
- `agent-browser install` downloads a Chrome for Testing build — one-time,
  but slow on first run. CI caches it.
- Default step timeout is 60s (`E2E_STEP_TIMEOUT`). A flaky CDP step that
  hits this is almost always a missing `wait` before the next step.

## Read when…

- …adding a flow                  → `README.md` § "How a flow works" + `specs/`
- …flow flakes locally            → run hermetic (`./scripts/e2e.sh`)
- …flow flakes only on CI         → `.github/workflows/e2e-web.yml` + `INSIGHTS.md`
- …UI change broke a flow         → `../client/CLAUDE.md` § "_components"
- …seeded data changed            → `../server/src/db/seed.ts`
- …past flake / locator gotcha    → `INSIGHTS.md`

## Module commands

- install agent-browser (once):  `npm i -g agent-browser && agent-browser install`
- hermetic (recommended):        `../scripts/e2e.sh` (or `npm run e2e:hermetic`)
- against your stack:            `npm test`  (only if dev DB has ONLY seed)
- typecheck:                     `npm run typecheck` (if defined)

## Sibling links

- Up:        `../CLAUDE.md`
- Exercises: `../client/CLAUDE.md` + `../server/CLAUDE.md`
- Seed data: `../server/src/db/seed.ts`
