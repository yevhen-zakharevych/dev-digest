---
name: zod-contracts
description: Zod schema placement rules — one schema for validation, serialization, and frontend types in @devdigest/shared
metadata:
  tags: zod, contracts, shared, validation, serialization, types
---

# Zod Contracts

## One Schema, Three Purposes

A single Zod schema in `@devdigest/shared` serves three roles simultaneously:
1. **Request validation** — Fastify rejects malformed bodies automatically
2. **Response serialization** — Fastify serializes return values against the schema
3. **TypeScript type** — `z.infer<typeof Schema>` used by services and the frontend

Define the schema once; use it everywhere.

## Where Schemas Live

```
server/src/vendor/shared/
├── contracts/
│   ├── repos.ts          # RepoInput, RepoSchema, RepoList
│   ├── pulls.ts          # PullInput, PullSchema, FindingSchema
│   ├── reviews.ts        # ReviewSchema, VerdictSchema
│   └── ...
├── adapters.ts           # Port interfaces (LLMProvider, GitHubClient, …)
└── index.ts              # Re-exports everything
```

Import from the alias, never from the path:

```ts
// CORRECT
import { RepoInput, type Repo } from '@devdigest/shared';

// WRONG — brittle path coupling
import { RepoInput } from '../../vendor/shared/contracts/repos.js';
```

## Schema Naming Conventions

| Pattern | Use |
|---|---|
| `XInput` | Request body schema (POST/PUT) — what the client sends |
| `XSchema` | Domain entity schema — what the service returns |
| `XList` | Array wrapper: `z.array(XSchema)` |
| `XParams` | URL params: `z.object({ id: z.string().uuid() })` |
| `XQuery` | Query string params |

```ts
// contracts/repos.ts
export const RepoInput = z.object({
  url: z.string().url(),
});

export const RepoSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  workspaceId: z.string().uuid(),
  status: z.enum(['pending', 'cloning', 'ready', 'failed']),
  lastPolledAt: z.string().datetime().nullable(),
});

export const RepoList = z.array(RepoSchema);
export type Repo = z.infer<typeof RepoSchema>;
export type RepoInput = z.infer<typeof RepoInput>;
```

## Usage in Routes

Pass schemas to the Fastify route config; never call `.parse()` manually:

```ts
import { RepoInput, RepoSchema, RepoList } from '@devdigest/shared';

app.post('/repos', {
  schema: {
    body: RepoInput,
    response: { 200: RepoSchema, 201: RepoSchema },
  },
}, async (req) => {
  // req.body is `RepoInput` typed, already validated
  return service.add(req.body.url);
});

app.get('/repos', {
  schema: { response: { 200: RepoList } },
}, async (req) => {
  return service.list(workspaceId);
});
```

## Inline Schemas Are Forbidden

Never define a Zod schema inline in a route or service:

```ts
// WRONG — inline schema is not shared, not versioned, duplicates logic
app.post('/repos', async (req) => {
  const { url } = z.object({ url: z.string().url() }).parse(req.body);
});
```

If a schema doesn't exist in `@devdigest/shared` yet, add it there first.

## Extending Schemas Without Redefining

Use Zod's `.extend()`, `.pick()`, `.omit()` to derive schemas from existing ones rather than defining parallel types:

```ts
// contracts/pulls.ts
export const PullSchema = z.object({ id: z.string(), title: z.string(), diff: z.string() });

// Derive a lightweight list item — no separate definition needed
export const PullListItem = PullSchema.omit({ diff: true });
export const PullList = z.array(PullListItem);
```

## Frontend Consumption

The frontend imports types directly from `@devdigest/shared` via the same path alias. This is the contract surface — never break existing schema shapes without a versioning strategy. Adding optional fields is always backwards-compatible; removing or changing types is not.
