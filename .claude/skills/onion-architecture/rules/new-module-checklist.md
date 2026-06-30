---
name: new-module-checklist
description: Step-by-step checklist for adding a new feature module under modules/<name>/
metadata:
  tags: checklist, new-module, scaffold, workflow
---

# New Module Checklist

Use this when scaffolding a new feature module at `server/src/modules/<name>/`.

## Step 1 — Define the contract (Domain layer)

Add Zod schemas to `@devdigest/shared` before writing any module code:

```ts
// server/src/vendor/shared/contracts/widgets.ts
export const WidgetInput = z.object({ name: z.string().min(1), kind: z.enum(['a', 'b']) });
export const WidgetSchema = z.object({ id: z.string().uuid(), name: z.string(), kind: z.string() });
export const WidgetList = z.array(WidgetSchema);
export type Widget = z.infer<typeof WidgetSchema>;
export type WidgetInput = z.infer<typeof WidgetInput>;
```

Export from `index.ts`:
```ts
export * from './contracts/widgets.js';
```

**Checklist:**
- [ ] `XInput` schema for request body
- [ ] `XSchema` schema for the entity
- [ ] `type X` inferred from schema
- [ ] Exported from `vendor/shared/index.ts`

## Step 2 — Define the DB table (Infrastructure)

Add a Drizzle table in `db/schema/`:

```ts
// db/schema/widgets.ts
export const widgets = pgTable('widgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  workspace_id: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
});
```

Run: `pnpm db:generate` → `pnpm db:migrate`

**Checklist:**
- [ ] Table added to `db/schema/widgets.ts`
- [ ] Imported in `db/schema.ts` (the barrel)
- [ ] Migration generated and applied

## Step 3 — Write the Repository (Application layer)

```ts
// modules/widgets/repository.ts
import type { Db } from '../../db/client.js';
import type { Widget } from '@devdigest/shared';
import { widgets } from '../../db/schema/widgets.js';
import { eq } from 'drizzle-orm';

export class WidgetRepository {
  constructor(private db: Db) {}

  async findById(id: string): Promise<Widget | null> {
    const [row] = await this.db.select().from(widgets).where(eq(widgets.id, id)).limit(1);
    return row ? this.toWidget(row) : null;
  }

  async create(data: { name: string; kind: string; workspaceId: string }): Promise<Widget> {
    const [row] = await this.db.insert(widgets).values({
      name: data.name,
      kind: data.kind,
      workspace_id: data.workspaceId,
    }).returning();
    return this.toWidget(row);
  }

  private toWidget(row: typeof widgets.$inferSelect): Widget {
    return { id: row.id, name: row.name, kind: row.kind };
  }
}
```

**Checklist:**
- [ ] All DB queries in repository, zero in service
- [ ] Returns domain types (not Drizzle rows)
- [ ] `tx?` param on methods that participate in transactions

## Step 4 — Write the Service (Application layer)

```ts
// modules/widgets/service.ts
import type { Container } from '../../platform/container.js';
import type { Widget } from '@devdigest/shared';
import { WidgetRepository } from './repository.js';
import { NotFoundError } from '../../platform/errors.js';

export class WidgetService {
  private repo: WidgetRepository;

  constructor(private container: Container) {
    this.repo = new WidgetRepository(container.db);
  }

  async get(workspaceId: string, id: string): Promise<Widget> {
    const widget = await this.repo.findById(id);
    if (!widget) throw new NotFoundError(`Widget ${id} not found`);
    return widget;
  }

  async create(workspaceId: string, input: WidgetInput): Promise<Widget> {
    return this.repo.create({ ...input, workspaceId });
  }
}
```

**Checklist:**
- [ ] No Drizzle imports
- [ ] No HTTP types (`FastifyRequest`, status codes)
- [ ] Dependencies come from `container`, not `new Adapter()`
- [ ] Throws typed errors from `platform/errors.ts`

## Step 5 — Write the Routes (Infrastructure layer)

```ts
// modules/widgets/routes.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { WidgetInput, WidgetSchema, WidgetList } from '@devdigest/shared';
import { IdParams } from '../_shared/schemas.js';
import { WidgetService } from './service.js';
import { getContext } from '../_shared/context.js';

export default async function widgetsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new WidgetService(app.container);

  app.post('/', { schema: { body: WidgetInput, response: { 201: WidgetSchema } } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    reply.status(201);
    return service.create(workspaceId, req.body);
  });

  app.get('/:id', { schema: { params: IdParams, response: { 200: WidgetSchema } } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.get('/', { schema: { response: { 200: WidgetList } } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });
}
```

**Checklist:**
- [ ] Schemas from `@devdigest/shared`, not inline
- [ ] No business logic
- [ ] No direct DB or adapter access
- [ ] Status codes set here (not in service)

## Step 6 — Register the Module

```ts
// modules/index.ts — add the new module
import widgetsRoutes from './widgets/routes.js';
app.register(widgetsRoutes, { prefix: '/widgets' });
```

## Step 7 — Write Tests

**Unit test** (`*.test.ts`) — service with mock repository:
```
modules/widgets/service.test.ts
```

**Integration test** (`*.it.test.ts`) — repository against real Postgres:
```
modules/widgets/repository.it.test.ts
```

**Checklist:**
- [ ] Unit test: service with mock repo via `ContainerOverrides`
- [ ] IT test filename ends `.it.test.ts`
- [ ] Route test: Fastify `inject()` covers happy path + 400 validation rejection
- [ ] No LLM calls in unit or IT tests

## Final Self-Check

Before opening a PR for the new module:

- [ ] `pnpm typecheck` passes in `server/`
- [ ] `pnpm test` passes (unit + IT)
- [ ] No `process.env` outside `config.ts`
- [ ] No `new ConcreteAdapter()` outside `container.ts`
- [ ] No Drizzle imports outside `db/` and `repository.ts`
- [ ] All Zod schemas in `@devdigest/shared`
- [ ] Module registered in `modules/index.ts`
