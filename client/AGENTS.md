# client — map (`@devdigest/web`, :3000)

Next.js 15 studio: import repos, browse PRs, run/read AI reviews, author
agents. See `README.md` for the UI route map.

## Stack notes (non-default)

- Next.js 15 App Router + React 19 (server + client components)
- TanStack Query for data (NOT SWR, NOT raw fetch in components)
- `next-intl` with messages in `messages/<locale>/*.json`
- `recharts`, `mermaid`, `react-markdown`
- UI primitives vendored at `src/vendor/ui` (`@devdigest/ui`)
- Zod contracts vendored at `src/vendor/shared` (`@devdigest/shared`)
- Vitest + jsdom for tests; `fetch` mocked (no API needed)

## Module map

- `src/app/`                  — App Router pages (`page.tsx`, `layout.tsx`)
- `src/app/<route>/_components/<Name>/` — colocated feature components + tests
- `src/components/app-shell/` — cross-cutting chrome (nav, breadcrumbs,
  `g`-then-key shortcuts)
- `src/lib/api.ts`            — single fetch base; reads `NEXT_PUBLIC_API_BASE`
- `src/lib/hooks/*`           — TanStack Query hooks per resource
- `src/i18n/`                 — next-intl setup
- `src/vendor/ui/`            — vendored UI primitives
- `src/vendor/shared/`        — vendored Zod contracts
- `messages/<locale>/*.json`  — i18n strings

## Conventions (non-default for this module)

- Pages are THIN. Feature logic sits in `_components/<Name>/` with its own
  `*.test.tsx` colocated.
- All API calls go through `src/lib/hooks/*` → `src/lib/api.ts`.
  No `fetch()` inside components or pages.
- Types for API responses come from `@devdigest/shared` Zod inferences,
  not redefined locally.
- Components default to RSC; opt into client with `"use client"` only when
  hooks/interactivity require it.
- Tests use RTL + userEvent + jsdom. No browser; real browser flows live
  in `../e2e/`.

## Gotchas

- `NEXT_PUBLIC_API_BASE` defaults to `http://localhost:3001`. Change in
  `.env`; rebuild required (it's inlined at build).
- `messages/` is loaded on the server; missing key in a locale = build-time
  error. Keep all locales in sync when adding strings.
- Vendored `src/vendor/shared` is the SAME source as server's vendored copy
  (logically). Drift between them = type mismatches at runtime — never edit
  one without the other.
- `_components/` (underscore prefix) is App Router's convention for "not a
  route" — don't drop the underscore or Next will try to make a page.

## Read when…

- …adding a page / route       → `README.md` § "UI route map"
- …adding a data hook          → `src/lib/hooks/` + `docs/data-fetching.md`
- …new i18n string             → `src/i18n/` + every `messages/<locale>/*.json`
- …UI primitive needed         → `src/vendor/ui/` (don't import from MUI etc.)
- …past UI gotcha              → `INSIGHTS.md`
- …real browser flow needed    → `../e2e/AGENTS.md`

## Module commands

- dev:        `pnpm dev`        (web on :3000)
- build:      `pnpm build`
- start:      `pnpm start`      (after build)
- typecheck:  `pnpm typecheck`
- test:       `pnpm test`       (vitest + jsdom, fetch mocked)

## Sibling links

- Up:           `../AGENTS.md`
- Talks to:     `../server/AGENTS.md` (REST + SSE)
- Validated by: `../e2e/AGENTS.md`    (browser flows)
