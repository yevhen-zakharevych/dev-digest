---
name: application
description: Application layer rules — service.ts orchestration and repository.ts as the DB boundary
metadata:
  tags: application, service, repository, use-cases, orchestration
---

# Application Layer

## What Lives Here

- `modules/<name>/service.ts` — use case orchestration
- `modules/<name>/repository.ts` — data access interface + implementation

## Service Rules

A service is an orchestrator. It coordinates domain logic, calls repositories and adapters via interfaces, and knows nothing about HTTP.

**Allowed in service.ts:**
- Calling domain functions from `@devdigest/reviewer-core` or `@devdigest/shared`
- Calling repository methods
- Calling adapter interfaces (received via DI, not imported directly)
- Throwing domain/application errors (not HTTP status codes)

**Forbidden in service.ts:**

```ts
// WRONG — HTTP concepts leak into application layer
import type { FastifyRequest, FastifyReply } from 'fastify';
reply.status(404).send({ error: 'not found' });

// WRONG — constructing adapters directly (bypasses DI)
const llm = new OpenAIProvider(process.env.OPENAI_API_KEY!);

// WRONG — direct DB access (bypasses repository)
const result = await db.select().from(schema.repos).where(...);

// WRONG — reading env directly
const apiKey = process.env.GITHUB_TOKEN;
```

**Correct pattern:**

```ts
export class RepoService {
  constructor(private container: Container) {}

  async add(workspaceId: string, userId: string, url: string) {
    const github = await this.container.github();      // interface, not impl
    const repo = await this.container.reviewRepo.find(workspaceId, url);
    if (repo) return { repo, created: false };
    const created = await this.container.reviewRepo.create({ workspaceId, userId, url });
    this.container.jobs.enqueue('clone', { repoId: created.id });
    return { repo: created, created: true };
  }
}
```

## Repository Rules

Repository is the **only** place that knows about the database. It translates between domain types and DB rows.

**Interface definition** — belongs in application layer (or shared if cross-module):

```ts
// modules/reviews/repository.ts — interface + Drizzle implementation together
export interface ReviewRepositoryPort {
  findById(id: string): Promise<Review | null>;
  create(data: NewReview): Promise<Review>;
  listByPull(pullId: string): Promise<Review[]>;
}

export class ReviewRepository implements ReviewRepositoryPort {
  constructor(private db: Db) {}

  async findById(id: string): Promise<Review | null> {
    const [row] = await this.db.select()
      .from(schema.reviews)
      .where(eq(schema.reviews.id, id))
      .limit(1);
    return row ?? null;
  }
  // ...
}
```

**Service depends on the interface, not the class:**

```ts
// Container exposes the concrete class, but service types against the interface
class ReviewService {
  constructor(private repo: ReviewRepositoryPort) {}
}
```

## Transactions

Pass the transaction object as an optional parameter — never pull `db` into service:

```ts
// repository.ts
async transfer(
  fromId: string,
  toId: string,
  tx?: typeof db,
): Promise<void> {
  const executor = tx ?? this.db;
  await executor.update(schema.accounts)
    .set({ balance: sql`balance - ${amount}` })
    .where(eq(schema.accounts.id, fromId));
  // ...
}

// service.ts — orchestrates the transaction
async transfer(fromId: string, toId: string, amount: number) {
  await this.db.transaction(async (tx) => {
    await this.accountRepo.transfer(fromId, toId, tx);
  });
}
```

The `db` instance in service.ts is the **only** acceptable direct DB reference in the application layer, and only for transaction demarcation — never for queries.

## Error Handling

Services throw typed application errors. Routes map them to HTTP status codes:

```ts
// platform/errors.ts — application-layer errors
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class ConfigError extends Error {}

// service.ts — throws application errors
if (!repo) throw new NotFoundError(`Repo ${id} not found`);

// routes.ts — maps to HTTP (infrastructure concern)
app.setErrorHandler((err, req, reply) => {
  if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
  // ...
});
```
