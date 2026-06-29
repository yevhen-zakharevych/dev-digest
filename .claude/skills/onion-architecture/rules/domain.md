---
name: domain
description: Domain layer rules — reviewer-core purity, shared contracts, and port interface definitions
metadata:
  tags: domain, reviewer-core, shared, ports, interfaces, purity
---

# Domain Layer

## What Lives Here

- **`reviewer-core/src/`** — pure review engine (diff → prompt → LLM → findings)
- **`server/src/vendor/shared/`** — Zod contracts, port interfaces shared by all packages

## The Purity Rule

`reviewer-core` has **zero** I/O dependencies. This is enforced structurally:

```ts
// FORBIDDEN in reviewer-core — any of these breaks purity
import fs from 'node:fs';
import { fetch } from 'node:fetch';
import 'fastify';
import 'drizzle-orm';
import 'postgres';
process.env.ANYTHING;

// ALLOWED — pure computation + injected interfaces only
import type { LLMProvider } from './llm/index.js';
import { z } from 'zod';
```

If you need I/O inside reviewer-core, the answer is always: **inject an interface, let the caller provide the implementation**.

## Port Interfaces (where to define them)

Port interfaces live in the innermost layer that needs them:

- `LLMProvider`, `GitHubClient`, `GitClient`, `Embedder`, `SecretsProvider`, `AuthProvider` → in `@devdigest/shared` (`adapters.ts`)
- `RepoIntel`, `DepGraph`, `Tokenizer` → in their respective module's `types.ts` (application layer, since only one module uses them)

```ts
// @devdigest/shared/adapters.ts — correct home for cross-cutting ports
export interface LLMProvider {
  complete(messages: Message[], opts?: CompletionOptions): Promise<CompletionResult>;
  listModels?(): Promise<ModelInfo[]>;
}
```

## Public API Surface

`reviewer-core/src/index.ts` is the **only** import point for consumers. Never reach into subpaths:

```ts
// CORRECT — use the public surface
import { runReview, groundFindings, assemblePrompt } from '@devdigest/reviewer-core';

// WRONG — bypasses the API surface, breaks on internal refactors
import { OpenRouterProvider } from '@devdigest/reviewer-core/src/llm/openrouter.js';
```

## Shared Contracts

`@devdigest/shared` types are the lingua franca between layers. They define what `Review`, `Finding`, `Verdict`, etc. look like. No layer redefines these:

```ts
// Every layer uses the same Finding type
import type { Finding, Verdict } from '@devdigest/shared';

// WRONG — redefining in a service or route
type LocalFinding = { severity: string; message: string };
```

## What Cannot Happen in Domain

| Action | Why |
|---|---|
| `import fastify` | Domain has no HTTP concept |
| `import { db } from '../../db'` | Domain has no persistence concept |
| `process.env.OPENAI_API_KEY` | Domain reads no environment |
| `new OpenAIProvider(key)` | Domain never instantiates adapters |
| Catch-all error → HTTP status mapping | That belongs in routes.ts |
