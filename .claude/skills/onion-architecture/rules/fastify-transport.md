---
name: fastify-transport
description: Fastify-specific transport rules — Zod type provider, SSE streaming, plugin registration, and route isolation
metadata:
  tags: fastify, routes, transport, sse, zod-type-provider, plugins
---

# Fastify Transport Rules

## Zod as the Single Validation Source

`fastify-type-provider-zod` makes Zod schemas drive both request validation and response serialization. Never duplicate this with manual parsing:

```ts
// CORRECT — schema from @devdigest/shared; framework handles parse + serialize
app.post('/repos', { schema: { body: RepoInput } }, async (req) => {
  // req.body is already typed and validated — no manual z.parse() needed
  return service.add(req.body.url);
});

// WRONG — Zod schema inline in route
app.post('/repos', async (req) => {
  const body = z.object({ url: z.string() }).parse(req.body); // duplicates infra
});

// WRONG — manual validation when schema exists
app.post('/repos', { schema: { body: RepoInput } }, async (req) => {
  if (!req.body.url) throw new Error('url required'); // Zod already did this
});
```

## SSE Streaming

SSE (`fastify-sse-v2`) is infrastructure. Services return `AsyncIterable`; routes wire it to the SSE response:

```ts
// service.ts — returns the stream abstraction
async *streamRunTrace(runId: string): AsyncIterable<TraceEvent> {
  for await (const event of this.container.runBus.subscribe(runId)) {
    yield event;
  }
}

// routes.ts — connects stream to SSE (infrastructure wiring only)
app.get('/runs/:id/trace', async (req, reply) => {
  const stream = service.streamRunTrace(req.params.id);
  return reply.sse(stream);
});
```

SSE and `/health*` endpoints are **exempt** from rate-limit configuration.

## Plugin Registration Order

```ts
// app.ts — this order is mandatory
await app.register(import('@fastify/helmet'));
await app.register(import('@fastify/cors'), { origin: config.clientOrigin });
await app.register(import('@fastify/rate-limit'), { max: 120, timeWindow: '1m' });
await app.register(errorHandler);          // maps domain errors → HTTP status
await app.register(containerPlugin);       // decorates app.container

// Feature modules LAST — they inherit all of the above
await app.register(reposModule, { prefix: '/api/repos' });
await app.register(reviewsModule, { prefix: '/api/reviews' });
```

## Container Access in Routes

Routes access the DI container via `app.container` (decorated by `containerPlugin`). Never import the Container class directly in a route:

```ts
// CORRECT
export default async function reposRoutes(app: FastifyInstance) {
  const service = new RepoService(app.container);
}

// WRONG — bypasses the plugin-decorated container
import { container } from '../../platform/container.js';
```

## Response Shape

Routes return plain objects. Fastify serializes them through the response schema. Avoid manually calling `reply.send()` for happy-path responses:

```ts
// CORRECT — return value, let Fastify serialize
app.get('/repos', async (req) => {
  return service.list(workspaceId);       // Fastify serializes via response schema
});

// AVOID — manual send for happy path
app.get('/repos', async (req, reply) => {
  const repos = await service.list(workspaceId);
  return reply.send(repos);              // only needed when you also set status
});

// CORRECT — when setting non-200 status
app.post('/repos', async (req, reply) => {
  const { repo, created } = await service.add(req.body.url);
  reply.status(created ? 201 : 200);
  return repo;
});
```

## Error Mapping

Route files must not contain try/catch for application errors — the global error handler registered in `app.ts` maps domain errors to HTTP:

```ts
// platform/errors.ts + errorHandler plugin handles this globally
// NotFoundError → 404, ConflictError → 409, ConfigError → 503, etc.

// WRONG — error mapping in route
app.get('/repos/:id', async (req, reply) => {
  try {
    return await service.get(req.params.id);
  } catch (e) {
    if (e instanceof NotFoundError) return reply.status(404).send({ error: e.message });
    throw e;
  }
});

// CORRECT — just let it bubble
app.get('/repos/:id', async (req) => {
  return service.get(req.params.id);    // NotFoundError caught by global handler
});
```
