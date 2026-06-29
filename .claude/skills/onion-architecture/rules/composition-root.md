---
name: composition-root
description: DI container rules — the single place that wires concrete implementations to interfaces
metadata:
  tags: di, container, composition-root, dependency-injection, wiring
---

# Composition Root (platform/container.ts)

## What It Is

`platform/container.ts` is the **only** file in the codebase that is legally allowed to `new ConcreteAdapter()`. It resolves all dependencies at startup and hands interfaces to the rest of the system.

## Core Contract

```
                  ┌─────────────────────┐
                  │   Container         │
                  │                     │
  Service ──────► │ .github()   ──────► │ ──► OctokitGitHubClient
  Service ──────► │ .git        ──────► │ ──► SimpleGitClient
  Service ──────► │ .llm('openai') ───► │ ──► OpenAIProvider
                  └─────────────────────┘
```

Services receive the `Container` and call typed getters. They never know which concrete class is behind the getter.

## Adding a New Dependency

Follow the pattern:

1. Define the port interface in the appropriate layer (`@devdigest/shared` for cross-cutting, module `types.ts` for module-local).
2. Implement the adapter in `adapters/<name>/`.
3. Add a `ContainerOverrides` field for the new port.
4. Add a lazy getter in `Container`.

```ts
// Step 3: add to overrides
export interface ContainerOverrides {
  // existing...
  myService?: MyServicePort;
}

// Step 4: lazy getter with override support
private _myService?: MyServicePort;

get myService(): MyServicePort {
  if (this.overrides.myService) return this.overrides.myService;
  this._myService ??= new MyServiceAdapter(this.config.myServiceUrl);
  return this._myService;
}
```

## Lazy Construction

All adapters are constructed lazily (on first access), not in the constructor. This keeps startup fast and allows tests to override before first use:

```ts
// CORRECT — lazy, cached
get repoIntel(): RepoIntel {
  if (this.overrides.repoIntel) return this.overrides.repoIntel;
  this._repoIntel ??= new RepoIntelService(this);
  return this._repoIntel;
}

// WRONG — eager construction in constructor
constructor(...) {
  this._repoIntel = new RepoIntelService(this);  // breaks overrides in tests
}
```

## Async Adapters (secrets-gated)

Adapters that require a secret key are async getters — they call `SecretsProvider.get()` rather than reading `process.env` directly:

```ts
async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;
  if (this._github) return this._github;
  const token = await this.secrets.get('GITHUB_TOKEN');
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
  this._github = new OctokitGitHubClient(token);
  return this._github;
}
```

This keeps the startup boot clean — the server starts without any keys configured; the settings UI provides them at runtime.

## Cache Invalidation

When a secret is updated at runtime, call `container.invalidateSecretCaches()` to force the next access to re-read and reconstruct:

```ts
// After saving a new API key via SecretsProvider.set():
container.invalidateSecretCaches();
// Next call to container.github() will pick up the new token
```

## Testing: Using Overrides

Tests construct a Container with mock adapters. This is the only way to test a service without hitting external services:

```ts
const mockGithub: GitHubClient = {
  getPull: vi.fn().mockResolvedValue(fakePull),
  listPulls: vi.fn().mockResolvedValue([]),
};

const container = new Container(testConfig, testDb, {
  github: mockGithub,
  llm: { openai: mockLLM },
});

const service = new RepoService(container);
// service.add() will use mockGithub — no real HTTP calls
```

## What Must NOT Be in Container

- Business logic (belongs in service.ts)
- DB queries (belongs in repository.ts)
- HTTP handling (belongs in routes.ts)
- Prompt assembly (belongs in reviewer-core)

Container is a wiring file only. If you're tempted to add logic here, it belongs one layer inward.
