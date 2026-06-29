---
name: onion-architecture
description: "Enforces Onion Architecture (Ports & Adapters) for backend modules in this repo. Use when adding routes, services, repositories, adapters, or touching platform/container.ts or reviewer-core/. Covers: layer dependency rules, Fastify transport isolation, Drizzle repository pattern, Zod contracts placement, DI composition root, and testing strategy by layer. Trigger terms: routes.ts, service.ts, repository.ts, adapters/, container.ts, reviewer-core, @devdigest/shared, DI, port, adapter, domain layer, application layer, infrastructure layer."
metadata:
  tags: architecture, onion, ports-adapters, fastify, drizzle, typescript, di, backend
---

## When to use

Use this skill when you need to:
- Add a new feature module (`modules/<name>/`)
- Create or modify an adapter in `adapters/`
- Change `platform/container.ts` (DI wiring)
- Edit `reviewer-core/` (domain/engine layer)
- Add a Zod contract to `@devdigest/shared`
- Decide where a piece of logic belongs
- Review whether a service, route, or adapter violates layer rules

## Layer Map (read this first)

```
┌──────────────────────────────────────────┐
│  INFRASTRUCTURE (outermost)              │
│  modules/<name>/routes.ts                │
│  adapters/* (github, llm, git, …)        │
│  db/ (Drizzle schema, migrations)        │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  APPLICATION                       │  │
│  │  modules/<name>/service.ts         │  │
│  │  modules/<name>/repository.ts      │  │
│  │                                    │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │  DOMAIN (innermost)          │  │  │
│  │  │  reviewer-core/              │  │  │
│  │  │  @devdigest/shared (types)   │  │  │
│  │  └──────────────────────────────┘  │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘

COMPOSITION ROOT: platform/container.ts
  (the only place that wires concrete → interface)
```

**The one rule that holds it all:** imports point inward only.
Inner layers never import from outer layers.

## Recommended Reading Order

- **New module from scratch:** `layers.md` → `application.md` → `infrastructure.md` → `composition-root.md` → `new-module-checklist.md`
- **Placing business logic:** `layers.md` → `domain.md` → `application.md`
- **Adding an adapter:** `infrastructure.md` → `composition-root.md`
- **Drizzle + repository questions:** `drizzle-repository.md`
- **Zod schema placement:** `zod-contracts.md`
- **Writing tests by layer:** `testing.md`
- **Something smells wrong:** `antipatterns.md`

## Rule Files

- [rules/layers.md](rules/layers.md) - Layer boundaries and the dependency rule
- [rules/domain.md](rules/domain.md) - Domain layer: reviewer-core and shared contracts
- [rules/application.md](rules/application.md) - Application layer: services and repositories
- [rules/infrastructure.md](rules/infrastructure.md) - Infrastructure layer: routes, adapters, db
- [rules/composition-root.md](rules/composition-root.md) - DI container wiring (container.ts)
- [rules/fastify-transport.md](rules/fastify-transport.md) - Fastify-specific transport rules
- [rules/drizzle-repository.md](rules/drizzle-repository.md) - Drizzle ORM + repository pattern
- [rules/zod-contracts.md](rules/zod-contracts.md) - Zod schema placement and sharing
- [rules/testing.md](rules/testing.md) - Testing strategy by layer
- [rules/antipatterns.md](rules/antipatterns.md) - Forbidden patterns and why

## Core Principles

- **Dependency rule**: inner layers define interfaces (ports); outer layers implement them (adapters)
- **Transport isolation**: routes.ts maps HTTP ↔ service; zero business logic allowed there
- **Pure domain**: reviewer-core has no framework imports, no process.env, no fs
- **Single composition root**: only container.ts calls `new ConcreteAdapter()`
- **One Zod schema**: validation + serialization + frontend type — defined once in @devdigest/shared
