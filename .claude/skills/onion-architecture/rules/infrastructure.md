---
name: infrastructure
description: Infrastructure layer rules — routes.ts as transport-only, adapters implementing ports, db/ as Drizzle details
metadata:
  tags: infrastructure, routes, adapters, drizzle, transport, http
---

# Infrastructure Layer

## What Lives Here

- `modules/<name>/routes.ts` — HTTP transport (Fastify plugin)
- `adapters/<name>/` — external system implementations (GitHub, LLM, Git, …)
- `db/schema/` — Drizzle table definitions and migrations

## routes.ts — Transport Only

A route file has one job: translate HTTP ↔ service. Every line of code that isn't HTTP parsing, service delegation, or status mapping is in the wrong file.

```ts
// CORRECT — transport-only route
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);        // construct service

  app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { repo, created } = await service.add(workspaceId, userId, req.body.url);
    reply.status(created ? 201 : 200);                   // HTTP concern lives here
    return repo;
  });
}
```

**Forbidden in routes.ts:**

```ts
// WRONG — business logic in route
if (repo.url.includes('github.com')) {
  await cloneWithToken(repo.url, githubToken);
}

// WRONG — direct DB access
const repos = await db.select().from(schema.repos);

// WRONG — constructing adapters
const github = new OctokitGitHubClient(process.env.GITHUB_TOKEN!);

// WRONG — inline Zod schema (belongs in @devdigest/shared)
const body = z.object({ url: z.string().url() });
```

## adapters/ — Port Implementations

Each adapter:
1. Implements exactly one port interface (from domain or shared)
2. Translates between the port's language and the external service's language
3. Has no business logic — only translation + error mapping

```ts
// adapters/github/octokit.ts
import type { GitHubClient, PullRequest } from '@devdigest/shared';

export class OctokitGitHubClient implements GitHubClient {
  constructor(private octokit: Octokit) {}

  async getPull(owner: string, repo: string, number: number): Promise<PullRequest> {
    const { data } = await this.octokit.rest.pulls.get({ owner, repo, pull_number: number });
    return this.mapToDomain(data);           // translate Octokit → domain type
  }

  private mapToDomain(data: OctokitPull): PullRequest { /* ... */ }
}
```

**Adapters never call each other directly.** If adapter A needs adapter B, the service orchestrates them.

## db/ — Drizzle Infrastructure Details

Drizzle schema is an infrastructure detail. Domain types and DB rows are kept separate:

```ts
// db/schema/repos.ts — infrastructure (Drizzle table)
export const repos = pgTable('repos', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
});

// @devdigest/shared — domain type (Zod)
export const RepoSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  workspaceId: z.string().uuid(),
});
export type Repo = z.infer<typeof RepoSchema>;
```

The repository is responsible for mapping between them. Services and routes use the domain type, never the Drizzle row type directly.

## Plugin Registration Order

Plugins that provide cross-cutting behaviour (security, rate-limiting, error handling) register **before** module plugins so modules inherit them automatically:

```ts
// app.ts — correct order
await app.register(helmet);
await app.register(cors, corsOptions);
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
await app.register(errorHandler);          // maps AppErrors → HTTP
// THEN feature modules
await app.register(reposRoutes, { prefix: '/repos' });
await app.register(reviewsRoutes, { prefix: '/reviews' });
```

## Rate Limiting

Rate limits are configured in routes.ts (infrastructure concern). The decision of which endpoints are expensive is an application-level judgement documented in the route config comment:

```ts
// POST /pulls/:id/review is expensive — LLM call + DB writes
app.post('/pulls/:id/review', {
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  schema: { params: IdParams },
}, async (req) => { /* ... */ });
```

SSE endpoints and `/health*` are always exempt from rate limits.
