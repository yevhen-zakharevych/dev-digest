# Next.js App Router — Layout & Organization

Where *your* code lives **inside** an App Router project. The special-file conventions themselves (`page.tsx`, `layout.tsx`, `error.tsx`, `route.ts`, etc.) are covered by `next-best-practices/file-conventions.md` — this file is about how to organize the rest of the codebase around them.

## The Two-Tier Rule

Split code into two tiers:

- **`src/app/`** — routing, layouts, page composition. **Thin.**
- **`src/features/`** + **`src/shared/`** — business logic, components, services. **Thick.**

A `page.tsx` should mostly assemble feature components and fetch data. The actual logic, validation, and UI composition live in features. If a page file is over ~150 lines, that is a refactor signal.

## Colocation Inside `app/`

Next.js permits non-routable files inside `app/`. Use this for **route-local** code that is not worth lifting to `features/` yet.

```
app/
└── dashboard/
    ├── page.tsx
    ├── layout.tsx
    ├── loading.tsx
    ├── error.tsx
    ├── _components/         # private — not routable
    │   ├── DashboardHeader.tsx
    │   └── StatsGrid.tsx
    ├── _hooks/
    │   └── useDashboardFilters.ts
    └── _lib/
        └── format-metric.ts
```

- **Underscore prefix** (`_components`, `_hooks`, `_lib`) — Next.js skips these for routing. This is the explicit, future-proof convention.
- A folder without underscore is also non-routable as long as it contains no `page.tsx` / `route.ts`, but the underscore makes intent explicit and avoids future name conflicts with Next.js conventions.

### When to colocate vs lift to `features/`

| Situation | Place it in |
|---|---|
| Used by exactly one route segment | `app/<route>/_components/` |
| Used by multiple routes in the same domain | `features/<domain>/components/` |
| Used across multiple domains | `shared/ui/` |

Start colocated. Lift only when the second consumer appears.

**Anti-pattern:** importing from a sibling route's `_components/`. That is a leak — if two routes need it, lift it to `features/` or `shared/`.

## Route Groups `(group)`

Folders wrapped in parentheses are **organizational** — they do not appear in the URL.

Use cases:
- Apply different root layouts to subsets of routes:
  ```
  app/
  ├── (marketing)/
  │   ├── layout.tsx       # public-site shell
  │   ├── page.tsx         # /
  │   └── pricing/page.tsx # /pricing
  └── (app)/
      ├── layout.tsx       # auth-gated shell
      ├── dashboard/page.tsx
      └── settings/page.tsx
  ```
- Group routes by team or concern without affecting URLs.
- Opt specific route segments into sharing a layout while keeping others out.

Don't overuse — one or two groups is usually enough for an app.

## `app/api/` (Route Handlers) vs Server Actions — Where Files Live

- **Route Handlers** (`app/api/.../route.ts`) — for external consumers (webhooks, mobile apps, third-party). They are the project's *public REST surface*; keep them in `app/api/` organized by external concept (e.g. `app/api/webhooks/github/route.ts`).
- **Server Actions** — for mutations invoked from your own UI. Define them inside the feature: `features/<name>/actions.ts`. Don't put them in random `app/` files.

(For the *decision matrix* of when to use which, see `next-best-practices/data-patterns.md`. This file just says where the files live.)

## Layout vs Template — Placement

- `layout.tsx` — persistent across navigation. Put global providers, navs, and persistent state here.
- `template.tsx` — re-mounts on navigation. Use when you need fresh state on every visit (rare).

If a layout is reused across multiple routes through composition (not Next's automatic nesting), extract its body to `features/<name>/layouts/` and import it from `app/.../layout.tsx`.

## A Realistic Full Layout

```
src/
├── app/
│   ├── layout.tsx                       # root layout
│   ├── (marketing)/
│   │   ├── layout.tsx
│   │   ├── page.tsx                     # /
│   │   └── pricing/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx
│   │   ├── dashboard/
│   │   │   ├── page.tsx
│   │   │   ├── loading.tsx
│   │   │   ├── error.tsx
│   │   │   └── _components/
│   │   │       └── DashboardHeader.tsx
│   │   └── settings/page.tsx
│   └── api/
│       └── webhooks/github/route.ts
├── features/
│   ├── auth/
│   ├── reviews/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── schemas/
│   │   ├── actions.ts                   # Server Actions
│   │   ├── types.ts
│   │   └── constants.ts
│   └── digest/
└── shared/
    ├── ui/                              # design-system primitives
    ├── utils/
    ├── hooks/
    ├── services/                        # http client, logger, etc.
    ├── types/
    └── constants/
```

## Anti-Patterns

- ❌ 200+ line `page.tsx` with data fetching, mutations, and UI inline.
- ❌ `app/components/` as a global UI dump. Either `shared/ui/` (primitives) or `features/<x>/components/` (domain).
- ❌ Server Actions scattered across random `app/` files instead of `features/<x>/actions.ts`.
- ❌ Importing from a sibling route's `_components/` — that's a leak.
- ❌ Deeply nested route segments (`app/(app)/dashboard/users/[id]/edit/page.tsx`) doing all the work inline; the depth is fine, the inline logic is not.
- ❌ Route Handlers under `app/api/` used purely for internal UI mutations — those are Server Actions.
