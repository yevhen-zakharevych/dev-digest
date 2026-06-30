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

Layered. Dependency direction: `vendor/` & `lib/` → `features/` → `app/`.
Sibling features MUST NOT import each other directly — lift the shared piece
to `lib/` or compose at the `app/` page level.

- `src/app/`                  — App Router pages (`page.tsx`, `layout.tsx`).
                                THIN: assemble feature components, fetch data.
- `src/app/<route>/_components/<Name>/` — route-local components (used by ONE route).
                                Lift to `src/features/` when a second consumer appears.
- `src/app/<route>/_lib/`     — route-local constants/helpers/styles
                                (underscore prefix = not routable).
- `src/features/<domain>/`    — domain modules: `components/`, `hooks/`,
                                `services/`, `constants.ts`, `types.ts`,
                                `helpers.ts`. Public API = top-level files.
- `src/components/`           — cross-cutting CHROME ONLY (`app-shell/`,
                                `page-shell/`). Domain widgets belong in
                                `src/features/`.
- `src/lib/`                  — shared infra (the `shared/` layer in
                                `frontend-architecture` skill terms):
                                `api.ts`, `hooks/`, providers, theme, toast,
                                shared types, project-wide helpers/constants.
- `src/lib/api.ts`            — single fetch base; reads `NEXT_PUBLIC_API_BASE`
- `src/lib/hooks/<domain>.ts` — TanStack Query hooks per resource
                                (import the domain file directly, not via barrel)
- `src/i18n/`                 — next-intl setup
- `src/vendor/ui/`            — vendored UI primitives (`@devdigest/ui`)
- `src/vendor/shared/`        — vendored Zod contracts (`@devdigest/shared`)
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

## Code organization rules

Reference: `.claude/skills/frontend-architecture/SKILL.md`
(plus `react-best-practices`, `next-best-practices`).

### Where each kind of file lives

| Concern | Location |
|---|---|
| React hooks (state, effects, queries) | `features/<x>/hooks/use<Name>.ts` (cross-feature TanStack hooks: `lib/hooks/<domain>.ts`) |
| API calls (services) | `lib/api.ts` today; per-domain service split when it grows |
| Pure helpers (project-specific) | `features/<x>/helpers.ts` or `lib/helpers/` if cross-feature |
| Generic utilities (domain-free, pure) | `lib/utils/` |
| Constants used in one component | `const` above the component, no separate file |
| Constants used by a feature | `features/<x>/constants.ts` |
| Constants used app-wide | `lib/constants/` |
| Types used in one file | inline (`type Props = …` above component) |
| Types used in a feature | `features/<x>/types.ts` |
| Types used app-wide | `lib/types.ts` |
| Zod schemas / contract types | `vendor/shared/contracts/*` (never redefine locally) |
| Route-local code (one route only) | `app/<route>/_components/`, `_hooks/`, `_lib/` |

### File naming

- `PascalCase.tsx` — one React component per file
- `useXxx.ts` — hooks
- `xxx.constants.ts`, `xxx.helpers.ts`, `xxx.types.ts` — suffix-based for clarity
- `xxx.test.tsx` colocated next to source

### Imports & exports

- **Named exports by default.** Default export ONLY for Next.js special files
  (`page.tsx`, `layout.tsx`, `error.tsx`, `loading.tsx`, `not-found.tsx`,
  `route.ts`, `template.tsx`, `default.tsx`).
- **NO `index.ts` barrel re-exports inside `app/` or feature folders.**
  Import directly from the source file. The only allowed barrel is the
  public-API boundary of a multi-export feature module (e.g. a vendored
  `vendor/ui/` package, or a feature module with 2+ outward-facing names).
- Use TS path aliases (`@/lib/...`, `@/features/...`) — not `../../../`.

### Component decomposition

- Split when pain appears, not preemptively (>200 lines, prop drilling 3+
  layers, can't describe in one sentence).
- Single-use sub-components live next to the parent in the same folder.
- Reusable primitives → `vendor/ui/` (already vendored).
- Domain composites → `features/<x>/components/`, NOT `src/components/`.

### Co-location rule

Promote outward only when a second consumer forces it:

```
1 file uses it      → inline, or `Component.helpers.ts` next to it
>1 file in feature  → `features/<x>/helpers.ts` (or split by domain)
>1 feature uses it  → `lib/helpers/`
```

Never start in `lib/` "because we might need it elsewhere." Speculative
reuse generates unused, untestable indirection.

## Migration in progress (target taxonomy)

The codebase is mid-migration from a flat layout to the layered model above.
While in flight, BOTH locations may exist — favour the TARGET when adding
new code. For background, see the session notes in `INSIGHTS.md`.

| Currently in | Target | Status |
|---|---|---|
| `src/components/diff-viewer/` | `src/features/reviews/diff-viewer/` | pending |
| `src/components/repo-not-found/` | `src/features/repos/RepoNotFound.tsx` | pending |
| `src/components/showcase/` | `src/app/(dev)/_showcase/` or remove | pending |
| `src/app/.../pulls/[number]/_components/RunTraceDrawer/` | `src/features/reviews/run-trace/` | pending |
| `src/app/.../pulls/{constants,helpers,styles}.ts` | `pulls/_lib/...` | pending |
| `src/lib/feature-models.ts` | `src/lib/constants/feature-models.constants.ts` | pending |
| `vendor/ui/primitives/tokens.ts` `Severity` | rename to `UISeverity` (disambiguate from `FindingSeverity`) | pending |
| `_components/<Name>/index.ts` barrels | direct imports (`./<Name>/<Name>`) | pending |
| `src/lib/hooks/index.ts` (`export *`) | direct domain imports (`@/lib/hooks/agents`) | pending |
| `_components/<Name>/index.ts` exports `as default` + named | named only | pending |

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

- …where does this file go?    → `.claude/skills/frontend-architecture/SKILL.md`
                                  + `client/AGENTS.md` § "Code organization rules"
- …writing a React component   → `.claude/skills/react-best-practices/SKILL.md`
- …Next.js mechanics question  → `.claude/skills/next-best-practices/SKILL.md`
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
