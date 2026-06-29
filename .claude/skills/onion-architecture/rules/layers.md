---
name: layers
description: Layer boundaries, the dependency rule, and how project directories map to Onion layers
metadata:
  tags: layers, onion, dependency-rule, architecture
---

# Layers

## Directory → Layer Mapping

| Layer | Directories | Purpose |
|---|---|---|
| **Domain** | `reviewer-core/src/`, `server/src/vendor/shared/` | Business rules, port interfaces, shared types |
| **Application** | `modules/<name>/service.ts`, `modules/<name>/repository.ts` | Use cases, orchestration, repository interfaces |
| **Infrastructure** | `modules/<name>/routes.ts`, `adapters/`, `db/` | HTTP transport, external services, Drizzle |
| **Composition Root** | `platform/container.ts` | Wires concrete implementations into interfaces |

## The Dependency Rule

```
Domain ← Application ← Infrastructure ← Composition Root
```

- A file may import from its own layer or any layer to its left.
- A file **must never** import from a layer to its right.
- `platform/container.ts` is the only exception — it imports from all layers to wire them together.

## Checking a Suspicious Import

Ask three questions:

1. **Which layer is the importing file in?**
2. **Which layer is the imported file in?**
3. **Does the import point inward (or same layer)?**

If the answer to #3 is no, the dependency is illegal.

```ts
// service.ts (Application) importing from routes.ts (Infrastructure) — ILLEGAL
import { parseIdParam } from './routes.js';

// service.ts (Application) importing from shared (Domain) — OK
import type { Finding } from '@devdigest/shared';

// routes.ts (Infrastructure) importing from service.ts (Application) — OK
import { ReviewService } from './service.js';
```

## Inter-layer Communication Pattern

Inner layers define **interfaces (ports)**. Outer layers provide **implementations (adapters)**.
The composition root injects the right implementation at startup.

```ts
// Domain layer: defines the port
export interface LLMProvider {
  complete(prompt: string): Promise<string>;
}

// Infrastructure layer: implements the port
export class AnthropicProvider implements LLMProvider {
  async complete(prompt: string) { /* ... */ }
}

// Composition root: wires them
get llm() { return new AnthropicProvider(apiKey); }

// Application layer: depends only on the interface
class ReviewService {
  constructor(private llm: LLMProvider) {}
}
```

## Module Boundary: reviewer-core vs server

`reviewer-core` is the purest domain — it is **consumed as TypeScript source** by `server/` via path alias. The alias is `@devdigest/reviewer-core`.

- `server/` may import from `reviewer-core` (outer consuming inner — correct).
- `reviewer-core` must **never** import from `server/` (would be inner importing outer — illegal).
- `reviewer-core`'s public API surface is `src/index.ts`. Consumers reach no deeper.
