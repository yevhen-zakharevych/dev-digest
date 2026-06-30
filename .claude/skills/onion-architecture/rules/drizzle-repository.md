---
name: drizzle-repository
description: Drizzle ORM repository pattern — isolating DB queries, mapping rows to domain types, and transaction handling
metadata:
  tags: drizzle, repository, orm, transactions, database, postgres
---

# Drizzle ORM + Repository Pattern

## Repository as the DB Boundary

Only repository files import Drizzle. Services, routes, and domain code never see `drizzle-orm` imports:

```ts
// CORRECT — Drizzle lives only in repository
// modules/reviews/repository.ts
import { eq, desc, and } from 'drizzle-orm';
import { reviews } from '../../db/schema/reviews.js';
import type { Db } from '../../db/client.js';

export class ReviewRepository {
  constructor(private db: Db) {}

  async findById(id: string): Promise<Review | null> {
    const [row] = await this.db.select()
      .from(reviews)
      .where(eq(reviews.id, id))
      .limit(1);
    return row ? this.toReview(row) : null;
  }
}

// WRONG — Drizzle leaking into service
// modules/reviews/service.ts
import { eq } from 'drizzle-orm';
import { reviews } from '../../db/schema/reviews.js';
const rows = await db.select().from(reviews).where(eq(reviews.id, id));
```

## Row → Domain Type Mapping

The repository is responsible for mapping between DB row types (Drizzle inferred) and domain types (Zod inferred from `@devdigest/shared`). Keep mapping in a private method:

```ts
export class ReviewRepository {
  private toReview(row: typeof reviews.$inferSelect): Review {
    return {
      id: row.id,
      pullId: row.pull_id,
      verdict: row.verdict as Verdict,
      findings: (row.findings as Finding[]) ?? [],
      createdAt: row.created_at.toISOString(),
    };
  }
}
```

Schema columns use snake_case (Postgres convention); domain types use camelCase (TypeScript convention). The mapper is the translation point — never alias columns in SQL to camelize.

## Transaction Pattern

Transactions are demarcated in the **service**, but executed through repository methods that accept an optional `tx` parameter:

```ts
// repository.ts — accepts optional tx
async create(data: NewReview, tx?: Db): Promise<Review> {
  const executor = tx ?? this.db;
  const [row] = await executor.insert(reviews).values(data).returning();
  return this.toReview(row);
}

async updateStatus(id: string, status: string, tx?: Db): Promise<void> {
  const executor = tx ?? this.db;
  await executor.update(reviews).set({ status }).where(eq(reviews.id, id));
}

// service.ts — owns the transaction boundary
async createAndNotify(data: NewReview): Promise<Review> {
  let created: Review;
  await this.db.transaction(async (tx) => {
    created = await this.reviewRepo.create(data, tx);
    await this.auditRepo.log('review.created', created.id, tx);
  });
  // Side-effects (notifications, SSE) happen AFTER commit
  this.container.runBus.emit(created!.id, { type: 'started' });
  return created!;
}
```

The `db` property in a service is acceptable **only** for `db.transaction()` demarcation. Never for queries.

## Schema vs Domain Types

Drizzle schema types (`$inferSelect`, `$inferInsert`) are infrastructure-only. Export domain types from `@devdigest/shared`:

```ts
// db/schema/repos.ts — infrastructure
export const repos = pgTable('repos', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  workspace_id: uuid('workspace_id').notNull().references(() => workspaces.id),
  last_polled_at: timestamp('last_polled_at'),
});

// @devdigest/shared — domain type (what services and routes work with)
export const RepoSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  workspaceId: z.string().uuid(),
  lastPolledAt: z.string().datetime().nullable(),
});
export type Repo = z.infer<typeof RepoSchema>;
```

Never export `typeof repos.$inferSelect` from the repository — callers must use the domain type.

## Migrations

Migrations live in `db/migrations/` and are applied manually via `pnpm db:migrate`. The server does NOT auto-migrate on boot.

- Schema change? Edit `db/schema/*.ts` → run `pnpm db:generate` → commit the migration file → run `pnpm db:migrate`.
- Empty tables in schema for future lessons are intentional — do not drop them.
- NEVER run `docker compose down -v` — it wipes `devdigest_pgdata` (all data).

## pgvector

`pgvector` extension is enabled by migration `0000`. Use the `vector` column type from `drizzle-orm/pg-core` for embedding columns. The `Embedder` port (in `@devdigest/shared`) returns `number[]`; the repository stores them as vectors.

```ts
import { vector } from 'drizzle-orm/pg-core';

export const codeChunks = pgTable('code_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
});
```
