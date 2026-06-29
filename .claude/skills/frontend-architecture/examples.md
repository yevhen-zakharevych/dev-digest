# Frontend Architecture — Examples & Walkthroughs

Concrete folder trees and "where does this go?" decisions.

## Small App (≤ ~30 modules)

You do not need a `features/` layer yet — flat is fine:

```
src/
├── app/                       # Next.js routes
│   ├── layout.tsx
│   ├── page.tsx
│   └── reviews/page.tsx
├── components/                # all components
│   ├── ui/                    # primitives
│   └── ReviewCard.tsx
├── hooks/
├── services/
├── utils/
├── types/
└── constants/
```

Promote to feature folders when one domain has >5 modules **or** two domains start crossing wires.

## Mid-to-Large App

Three layers, feature-sliced:

```
src/
├── app/                       # thin — routing + composition only
├── features/
│   ├── auth/
│   ├── reviews/
│   ├── digest/
│   └── settings/
└── shared/
    ├── ui/                    # design-system primitives (Button, Input, Card)
    ├── hooks/                 # generic hooks (useDebounce, useMediaQuery)
    ├── utils/                 # pure helpers
    ├── services/              # cross-feature services (http client, logger)
    ├── types/
    └── constants/
```

## Anatomy of One Feature

```
features/reviews/
├── components/
│   ├── ReviewList.tsx
│   ├── ReviewCard.tsx
│   ├── ReviewCard.helpers.ts          # used only by ReviewCard
│   └── ReviewForm/
│       ├── ReviewForm.tsx
│       ├── ReviewForm.SubmitButton.tsx
│       └── ReviewForm.test.tsx
├── hooks/
│   ├── useReviews.ts
│   └── useSubmitReview.ts
├── services/
│   └── reviews.service.ts             # fetchReviews(), createReview()
├── schemas/
│   └── review.schema.ts               # Zod schema + inferred Review type
├── actions.ts                         # Server Actions (Next.js)
├── types.ts                           # types used across the feature
└── constants.ts                       # REVIEW_STATUSES, MAX_LENGTH, etc.
```

---

## Decision Walkthrough — `formatReviewDate`

1. Used by exactly one component? → inline, or `ReviewCard.helpers.ts` next to it.
2. Used by multiple files inside `features/reviews/`? → `features/reviews/utils.ts` (or `date.utils.ts` if a date file grows).
3. Used by multiple features? → `shared/utils/date.utils.ts`.
4. Mentions a domain type in the name? → it's a **helper**, not a util — stays inside the feature regardless of how many consumers.

## Decision Walkthrough — `REVIEW_STATUSES`

- One component uses it → above-component `const REVIEW_STATUSES = [...]`.
- Multiple `reviews/` files use it → `features/reviews/constants.ts`.
- Used in `reviews/` *and* `digest/` → `shared/constants/review.constants.ts`, **and** ask whether the two features should merge (often they should).

## Decision Walkthrough — `useReviews` (hook or service?)

- Calls `useState` / `useEffect` / `useQuery`? → **hook**, in `features/reviews/hooks/useReviews.ts`.
- Pure async function returning `Promise<Review[]>`? → **service**, in `features/reviews/services/reviews.service.ts`. The hook *calls* the service.

Pattern:

```ts
// features/reviews/services/reviews.service.ts
export async function fetchReviews(filter: Filter): Promise<Review[]> {
  const res = await api.get('/reviews', { params: filter });
  return res.data;
}

// features/reviews/hooks/useReviews.ts
import { useQuery } from '@tanstack/react-query';
import { fetchReviews } from '../services/reviews.service';

export function useReviews(filter: Filter) {
  return useQuery({
    queryKey: ['reviews', filter],
    queryFn: () => fetchReviews(filter),
  });
}
```

The service is unit-testable without React. The hook is the React-aware wrapper.

## Decision Walkthrough — A `<DigestEntry>` used by both Reviews and Digest features

You have three options. Pick by **direction of dependency**:

1. **Lift to `shared/ui/`** — only if the component is now domain-free (no "review" or "digest" concept inside).
2. **Move to one feature, compose at `app/`** — if it conceptually belongs to one feature, the other one's page just imports it through composition at the page level.
3. **Extract a third feature** — if the shared component implies a shared domain concept (e.g. "feed item"), create `features/feed/` and have both `reviews/` and `digest/` depend on it through `shared/` or compose at `app/`. Never let `reviews/` import from `digest/` directly.

---

## Anti-Pattern Gallery

### ❌ Top-level technical buckets at scale

```
src/
├── components/        # 200 files, can't find anything
├── hooks/             # 80 files
└── utils/             # 50 files
```

Feature boundaries are invisible. Refactor pressure is huge. Move to `features/`.

### ❌ Mega `helpers.ts` / `utils.ts`

```
utils/helpers.ts       # 1200 lines, 47 unrelated functions
```

Split by domain: `date.utils.ts`, `array.utils.ts`, `currency.utils.ts`.

### ❌ Barrel files everywhere

```
features/reviews/index.ts:
  export * from './components';
  export * from './hooks';
  export * from './services';
  ...
```

Slow tooling, breaks tree-shaking, "go to definition" lands in the barrel. Import directly:

```ts
import { useReviews } from '@/features/reviews/hooks/useReviews';
```

### ❌ Feature → feature import

```ts
// features/digest/components/Entry.tsx
import { Review } from '@/features/reviews/types';     // ⚠ coupling
```

Either lift `Review` to `shared/types/`, compose at `app/`, or recognize the features should merge.

### ❌ Page-as-feature

```
app/dashboard/page.tsx     # 600 lines of fetch + UI + handlers
```

Pages should mostly assemble feature components and fetch data. The 600 lines belong in `features/dashboard/`.

### ❌ Speculative `shared/`

```
shared/utils/parseInternalReviewId.ts   # one consumer, project-specific
```

A "shared" file with one caller is not shared — it's misplaced. And if it knows about reviews, it's a helper, not a util.

### ❌ Domain composite in `shared/ui/`

```
shared/ui/ReviewCard.tsx
```

`ReviewCard` knows about reviews — it belongs in `features/reviews/components/`. Reserve `shared/ui/` for primitives (`Button`, `Input`, `Modal`).
