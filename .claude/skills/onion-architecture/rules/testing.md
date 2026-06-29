---
name: testing
description: Testing strategy by layer — unit tests with mocks, integration tests with testcontainers, and E2E browser flows
metadata:
  tags: testing, vitest, testcontainers, unit, integration, e2e, mocks
---

# Testing by Layer

## Test Pyramid

```
        ┌───────┐
        │  E2E  │  e2e/ — real browser, real stack, no mocks
        └───────┘
      ┌───────────┐
      │Integration│  *.it.test.ts — testcontainers Postgres + real migrations
      └───────────┘
    ┌───────────────┐
    │  Unit Tests   │  *.test.ts — hermetic, mocks at adapter boundary
    └───────────────┘
```

The filename suffix controls which tier runs in CI. **Never rename without updating CI.**

| File pattern | Tier | DB | LLM |
|---|---|---|---|
| `*.test.ts` | Unit | Mock | Mock |
| `*.it.test.ts` | Integration | testcontainers Postgres | Mock |
| `e2e/**` | E2E | Real (docker-compose) | Real |

## Unit Tests (service.ts + domain)

Test services with mocked repositories and adapters. Use `ContainerOverrides`:

```ts
// modules/reviews/service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewService } from './service.js';
import { Container } from '../../platform/container.js';

const mockRepo = {
  findById: vi.fn(),
  create: vi.fn(),
  listByPull: vi.fn(),
};

const mockLLM = {
  complete: vi.fn().mockResolvedValue({ text: '{"findings": []}', usage: {} }),
};

let service: ReviewService;
beforeEach(() => {
  vi.clearAllMocks();
  const container = new Container(testConfig, fakeDb, {
    llm: { openai: mockLLM },
  });
  // inject mock repo directly since it's not a Container getter
  service = new ReviewService(container, mockRepo);
});

it('returns empty findings when LLM returns no issues', async () => {
  mockRepo.findById.mockResolvedValue(fakePull);
  const result = await service.runReview('pull-id', 'openai');
  expect(result.findings).toHaveLength(0);
});
```

## Unit Tests (reviewer-core)

`reviewer-core` is fully hermetic — no testcontainers needed. Stub the `LLMProvider`:

```ts
// reviewer-core/src/review/run.test.ts
import { runReview } from './run.js';
import type { LLMProvider } from '../llm/index.js';

const stubLLM: LLMProvider = {
  complete: vi.fn().mockResolvedValue({
    text: JSON.stringify({ findings: [{ severity: 'high', message: 'SQL injection' }] }),
    usage: { input: 100, output: 50 },
  }),
};

it('grounds findings against real diff lines', async () => {
  const result = await runReview({ diff: fakeDiff, llm: stubLLM, agent: testAgent });
  // Grounding drops findings not citing a real diff line
  expect(result.findings.every(f => f.line !== undefined)).toBe(true);
});
```

## Integration Tests (repository + DB)

Filename must end `.it.test.ts`. Uses testcontainers to spin up a real Postgres:

```ts
// modules/repos/repository.it.test.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '../../db/migrate.js';
import { createDb } from '../../db/client.js';
import { RepoRepository } from './repository.js';

let container: StartedPostgreSqlContainer;
let repo: RepoRepository;

beforeAll(async () => {
  container = await new PostgreSqlContainer().start();
  const db = createDb(container.getConnectionUri());
  await runMigrations(db);
  repo = new RepoRepository(db);
}, 60_000);

afterAll(() => container.stop());

it('creates and retrieves a repo', async () => {
  const created = await repo.create({ url: 'https://github.com/a/b', workspaceId: ws.id });
  const found = await repo.findById(created.id);
  expect(found?.url).toBe('https://github.com/a/b');
});
```

## What Each Layer Tests

| Layer | Tests | Does NOT test |
|---|---|---|
| Domain (`reviewer-core`) | Prompt assembly, grounding logic, JSON repair | LLM responses, DB |
| Application (`service.ts`) | Use case orchestration, error conditions | Real HTTP, real DB |
| Application (`repository.ts`) | SQL correctness, mapping, transactions | Service logic |
| Infrastructure (`routes.ts`) | Status codes, Zod validation rejection | Business logic |

## Testing Routes (Transport Layer)

Route tests use Fastify's `inject()` — no real HTTP needed. Focus on transport: valid body accepted, invalid body rejected, service result mapped to correct status:

```ts
// modules/repos/routes.it.test.ts
it('returns 201 for new repo, 200 for existing', async () => {
  const app = buildTestApp({ repos: mockRepoService });

  const first = await app.inject({
    method: 'POST',
    url: '/repos',
    payload: { url: 'https://github.com/a/b' },
  });
  expect(first.statusCode).toBe(201);

  mockRepoService.add.mockResolvedValue({ repo: fakeRepo, created: false });
  const second = await app.inject({ method: 'POST', url: '/repos', payload: { url: 'https://github.com/a/b' } });
  expect(second.statusCode).toBe(200);
});

it('rejects body without url', async () => {
  const res = await app.inject({ method: 'POST', url: '/repos', payload: {} });
  expect(res.statusCode).toBe(400);
});
```

## E2E Tests

E2E lives in `e2e/`. They run against the real stack started by `./scripts/e2e.sh` and use a browser automation approach — no LLM calls, deterministic flows only. Do not add LLM-dependent assertions to E2E.
