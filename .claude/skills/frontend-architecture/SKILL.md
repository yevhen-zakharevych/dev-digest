---
name: frontend-architecture
description: "Frontend code organization for React + Next.js (App Router). Use when deciding where files should live, structuring a feature module, splitting components, or placing constants / utils / helpers / types / business logic. Focused on layout and module boundaries, NOT on component behavior or runtime performance."
version: 1.0.0
---

# Frontend Architecture & Code Organization

Rules for **where code lives** in a React + Next.js project. This skill answers "in which folder/file does this go?" and "is this the right boundary?" — it does not cover *how* a component should behave or how to make it fast.

- Component behavior (hooks, state, effects, anti-patterns) → see `react-best-practices`
- Next.js mechanics (RSC, special files, image/font/bundling) → see `next-best-practices`
- For Next.js App Router layout specifics → see [nextjs-layout.md](nextjs-layout.md)
- For concrete folder trees and decision walkthroughs → see [examples.md](examples.md)
- For scope boundaries, sources, and version policy → see [README.md](README.md)

## Severity Levels

- **CRITICAL** — Will cause accidental coupling, scaling pain, or block refactors
- **HIGH** — Will erode clarity and onboarding cost as the codebase grows
- **MEDIUM** — Convention / consistency

---

## Project Layout (CRITICAL)

### Three Layers, One Direction

Organize `src/` as three layers with one-way dependencies:

```
src/
├── app/        # routing + page composition (Next.js app/, route entrypoints)
├── features/   # business domains (auth, reviews, digest, settings)
└── shared/     # generic, domain-agnostic building blocks
```

Dependency rule: **`shared` ← `features` ← `app`**.

- A feature MUST NOT import from another feature directly. Either lift the shared piece to `shared/`, or compose them at the `app/` level.
- `shared/` MUST NOT import from `features/` or `app/`.
- Circular imports between features = the boundary is wrong; merge or extract.

### Group by Feature, Not by Type

Group code that *changes together*, not code that *looks alike*. A top-level `components/` + `hooks/` + `utils/` layout breaks down past ~30 files.

- ✅ `features/checkout/{components,hooks,services,types}`
- ❌ `components/Checkout*, hooks/useCheckout*, utils/checkout*`

### Cap Nesting Depth

3–4 levels max inside `src/`. If you need a 5th, you're hiding a missing feature boundary or premature abstraction.

---

## Feature Module Structure (HIGH)

Each feature is a self-contained slice:

```
features/<name>/
├── components/      # feature-specific UI (not shared)
├── hooks/           # React-aware logic
├── services/        # framework-agnostic logic & API calls
├── schemas/         # Zod schemas (request/response/validation)
├── actions.ts       # Next.js Server Actions (if used)
├── types.ts         # cross-file types within the feature
├── constants.ts     # feature-scoped constants
└── utils.ts         # feature-scoped pure helpers (optional)
```

- A feature's **public API** is what is reachable from its top-level files (`components/<X>`, `hooks/<X>`, `services/<X>`, `types`, `constants`, `actions`). Reaching into `services/internal/_token.ts` from outside the feature is a smell.
- Imports between features go through the public surface, never via deep paths.
- Use `tsconfig.json` `paths` aliases (`@/features/*`, `@/shared/*`) — not `../../../`.

---

## Co-location Rule (CRITICAL)

"Things that change together live together." Start local, promote outward only when a second consumer forces it.

| Reuse scope | Place it in |
|---|---|
| One file | inline, or `Component.helpers.ts` next to the component |
| Multiple files in one feature | `features/<name>/utils.ts` (or split: `date.utils.ts`) |
| Multiple features | `shared/utils/` |

Never start in `shared/` "because we might need it elsewhere." Speculative reuse is the most common source of unused, untestable indirection.

---

## Where Business Logic Lives (CRITICAL)

UI components render and dispatch — nothing else.

| Concern | Lives in |
|---|---|
| React state, effects, subscriptions, query/mutation hooks | `hooks/use<Name>.ts` |
| API calls, data transforms, domain rules | `services/<name>.service.ts` |
| Pure transforms (formatting, sorting, math) | `utils/` (generic) or `helpers/` (project-specific) |
| Validation schemas | `schemas/<name>.schema.ts` (Zod, derive type via `z.infer`) |
| Mutations invoked from the UI in Next.js | `actions.ts` (Server Actions) |

Rule of thumb: **if a function references React (hooks, JSX), it's a hook; otherwise it's a service or util.** Services are framework-agnostic — should be unit-testable without rendering anything.

---

## Utils vs Helpers (MEDIUM)

A common point of confusion — pick one convention and apply it consistently.

- **`utils/`** — generic, pure, no domain knowledge. Could ship to another project unchanged. Examples: `formatDate`, `parseCurrency`, `debounce`, `groupBy`.
- **`helpers/`** — project-specific glue, depends on this project's domain. Examples: `buildReviewPayload`, `mapDigestToViewModel`.

Rules:
- Side effects (logging, IO, network) → NOT in `utils/`. Those belong in `services/`.
- Don't write a single 1200-line `utils.ts` / `helpers.ts`. Split by domain: `date.utils.ts`, `array.utils.ts`, `currency.utils.ts`.
- If a "util" depends on a project type (e.g. `Review`), it's a helper.

---

## Constants (HIGH)

- **App-wide** → `src/shared/constants/` (theme tokens, breakpoints, route paths, public env keys, feature-flag names).
- **Feature-scoped** → `features/<name>/constants.ts`.
- **Single-use** → module-level `const` above the component (no separate file).

Rules:
- Never inline a magic number/string that appears in more than one place.
- Group related constants in one file (`statuses.constants.ts`), not one constant per file.
- Secret values never go in constants — those are env vars.

---

## Types Placement (HIGH)

Start colocated, promote on the second use:

| Used by | Lives in |
|---|---|
| One component | Same file (`type Props = …` above the component) |
| Multiple files in one feature | `features/<name>/types.ts` |
| Multiple features | `shared/types/` |
| API contract | `schemas/*.schema.ts` (derive via `z.infer`, don't hand-write twin types) |

Use `.types.ts` suffix on type-only files so they are greppable.

---

## Component Decomposition (HIGH)

Split a component when **pain appears**, not preemptively.

Signals it's time to split:
- It does more than one thing the user would describe in a single sentence
- The same prop is threaded through 3+ layers (prop drilling)
- You need to mock half the universe to mount it in a test
- The file is >200 lines

Anti-signal: splitting a 20-line component into 4 components "to be clean." That is premature abstraction — inline it.

Single-use sub-components live next to the parent:

```
features/checkout/components/PaymentForm/
├── PaymentForm.tsx
├── PaymentForm.SubmitButton.tsx     # used only by PaymentForm
├── PaymentForm.helpers.ts
└── PaymentForm.test.tsx
```

Reusable UI primitives (`Button`, `Input`, `Card`) → `shared/ui/`.

---

## Shared UI Layer (MEDIUM)

Reserve `shared/ui/` (or `components/ui/`) for **design-system primitives**:

- Domain-free (no knowledge of "user", "order", "review")
- Single purpose, stable API
- Tested in isolation

Domain-aware composites (`<UserCard>`, `<ReviewList>`) belong **inside their feature**, not in `shared/ui/`.

---

## File Naming (MEDIUM)

Suffix-based conventions make file purpose obvious and greppable:

| Pattern | Use |
|---|---|
| `PascalCase.tsx` | React components (one component per file) |
| `useXxx.ts` | React hooks |
| `xxx.service.ts` | Service modules |
| `xxx.schema.ts` | Zod schemas |
| `xxx.types.ts` | Type-only files |
| `xxx.constants.ts` | Constants modules |
| `xxx.helpers.ts` | Local / project-specific helpers |
| `xxx.utils.ts` | Generic utilities |
| `xxx.test.ts(x)` | Tests, colocated next to source |

Pick one casing style for non-component files (kebab-case OR camelCase) and apply it everywhere — do not mix.

---

## Exports (MEDIUM)

- **Named exports by default.** They preserve symbol identity, help auto-import and rename refactors, and keep hook names consistent (lint rules depend on it).
- **Default exports only** where the framework requires it: Next.js `page.tsx`, `layout.tsx`, `error.tsx`, `loading.tsx`, `not-found.tsx`, `route.ts`, `template.tsx`, `default.tsx`.
- **Avoid barrel files (`index.ts` re-exports) inside app code.** They slow Turbopack/webpack, hurt tree-shaking, invite circular imports, and break "go to definition." Import directly from the source file.
- Barrel files are OK only at the **public edge of a published package** — not your internal app layers.

---

## Module Boundaries (HIGH)

- A feature's *direct children* are its public API. Anything deeper (`_internal/`, prefixed with `_`) is private.
- Enforce paths with TS aliases instead of relative chains.
- Past ~30 modules, add lint enforcement: `eslint-plugin-boundaries` or `eslint-plugin-import` `no-restricted-paths`.
- A new file appearing in `shared/` from a feature is an architectural event — review it.

---

## Next.js App Router Layout

See [nextjs-layout.md](nextjs-layout.md) for:
- The two-tier rule (`app/` thin, `features/` thick)
- Private folders `_components/`, `_hooks/`, `_lib/` inside `app/`
- Route groups `(group)/` for layout segmentation without URL impact
- When to colocate inside a route segment vs lift to `features/`
- Where `actions.ts` (Server Actions) live
- Layout vs Template placement

---

## Anti-Pattern Quick Reference

- ❌ Top-level `components/` + `hooks/` + `utils/` with 100+ files (refactor pressure)
- ❌ A 1200-line `helpers.ts` / `utils.ts` (split by domain)
- ❌ Barrel `index.ts` re-exports inside app code (tooling/perf cost)
- ❌ `features/digest/` importing from `features/reviews/` (lift or compose)
- ❌ 600-line `page.tsx` doing data + UI + handlers (extract feature components)
- ❌ Speculative `shared/utils/X` with one consumer (inline back into the feature)
- ❌ Domain-aware components in `shared/ui/` (they belong in a feature)
- ❌ Magic strings/numbers repeated across files (extract to `constants.ts`)

See [examples.md](examples.md) for full walkthroughs.
