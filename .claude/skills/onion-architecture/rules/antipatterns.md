---
name: antipatterns
description: Forbidden patterns in backend modules — dependency violations, infrastructure leaking into domain, and DI bypass
metadata:
  tags: antipatterns, violations, forbidden, dependency-rule
---

# Antipatterns

## Dependency Rule Violations

### Adapter instantiated outside Container

```ts
// WRONG — bypasses DI, untestable, key hardcoded or from process.env
const llm = new OpenAIProvider(process.env.OPENAI_API_KEY!);
const github = new OctokitGitHubClient(token);

// CORRECT — ask the container
const llm = await this.container.llm('openai');
const github = await this.container.github();
```

### Inner layer importing outer layer

```ts
// WRONG — reviewer-core importing from server (inner → outer)
// reviewer-core/src/grounding.ts
import { db } from '../../../server/src/db/client.js';

// WRONG — service importing from routes (application → infrastructure)
import { parseIdParam } from './routes.js';

// WRONG — shared contract importing an adapter implementation
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
```

### reviewer-core with framework import

```ts
// WRONG — domain layer knows about Fastify
import type { FastifyInstance } from 'fastify';
import { FastifyError } from 'fastify';

// WRONG — domain layer reads environment
const apiKey = process.env.OPENAI_API_KEY;

// WRONG — domain layer does I/O
import fs from 'node:fs';
const prompt = fs.readFileSync('prompt.md', 'utf-8');
```

## Business Logic in Wrong Layer

### SQL in service

```ts
// WRONG — service writing Drizzle queries directly
import { eq } from 'drizzle-orm';
import { reviews } from '../../db/schema.js';

async getReview(id: string) {
  const [row] = await this.db.select().from(reviews).where(eq(reviews.id, id));
  return row;
}

// CORRECT — delegate to repository
async getReview(id: string) {
  return this.reviewRepo.findById(id);
}
```

### Business logic in routes

```ts
// WRONG — decision-making in transport layer
app.post('/pulls/:id/review', async (req) => {
  const pull = await db.select().from(pulls).where(eq(pulls.id, req.params.id));
  if (!pull[0]) return reply.status(404).send({ error: 'not found' });
  if (pull[0].diff.length > 50_000) return reply.status(400).send({ error: 'diff too large' });
  const findings = await llm.complete(buildPrompt(pull[0].diff));
  await db.insert(reviews).values({ pullId: pull[0].id, findings });
  return { ok: true };
});

// CORRECT — route just delegates
app.post('/pulls/:id/review', { schema: { params: IdParams } }, async (req) => {
  return service.runReview(req.params.id, req.body.agentId);
});
```

### HTTP status in service

```ts
// WRONG — HTTP concept leaking into application layer
async getRepo(id: string) {
  const repo = await this.repoRepo.findById(id);
  if (!repo) return { statusCode: 404, error: 'Not found' };
  return { statusCode: 200, data: repo };
}

// CORRECT — throw a typed error; route/error-handler maps to HTTP
async getRepo(id: string) {
  const repo = await this.repoRepo.findById(id);
  if (!repo) throw new NotFoundError(`Repo ${id} not found`);
  return repo;
}
```

## Schema and Contract Violations

### Inline Zod schema in route

```ts
// WRONG — not shared, not versioned, duplicated if used elsewhere
app.post('/repos', async (req) => {
  const { url } = z.object({ url: z.string().url() }).parse(req.body);
});

// CORRECT — defined once in @devdigest/shared
import { RepoInput } from '@devdigest/shared';
app.post('/repos', { schema: { body: RepoInput } }, async (req) => { ... });
```

### Drizzle row type escaping repository

```ts
// WRONG — repository returns raw Drizzle row
async findById(id: string) {
  const [row] = await this.db.select().from(reviews).where(eq(reviews.id, id));
  return row;  // type is typeof reviews.$inferSelect — infrastructure detail
}

// CORRECT — map to domain type before returning
async findById(id: string): Promise<Review | null> {
  const [row] = await this.db.select().from(reviews).where(eq(reviews.id, id));
  return row ? this.toReview(row) : null;  // Review = z.infer<typeof ReviewSchema>
}
```

### Reaching into reviewer-core subpaths

```ts
// WRONG — bypasses index.ts as API surface
import { OpenRouterProvider } from '@devdigest/reviewer-core/src/llm/openrouter.js';

// CORRECT — use the public API
import { OpenRouterProvider } from '@devdigest/reviewer-core';
```

## Secrets and Config

### Direct process.env in non-config code

```ts
// WRONG — any file other than config.ts
const token = process.env.GITHUB_TOKEN;

// CORRECT — use SecretsProvider (goes through LocalSecretsProvider)
const token = await this.container.secrets.get('GITHUB_TOKEN');
```

### Required key check at startup

```ts
// WRONG — server boots only if key is present (breaks settings UI flow)
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required');
}

// CORRECT — fail lazily when the feature is first used
// loadConfig marks secrets optional; the settings UI provides them at runtime
```
