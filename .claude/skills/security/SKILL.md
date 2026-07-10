---
name: security
description: "Web application security best practices for DevDigest's actual stack — Fastify 5 API + Drizzle/Postgres 16 + Next.js 15/React 19 + Zod contracts, no Express/MongoDB/JWT. Use when reviewing code for vulnerabilities, implementing auth/authorization, handling user input, working with file uploads, managing secrets, or building API endpoints. Split OWASP framework: API Security Top 10 (2023) for server/, Web Top 10:2025 for client/. Covers Fastify, Drizzle, Postgres, Next.js, and the repo's own INJECTION_GUARD prompt-injection defense."
---

# Security Best Practices — DevDigest Stack

Security guidance for Fastify 5 + Drizzle ORM + Postgres 16/pgvector + Next.js 15/React 19 +
Zod-first contracts. This repo has **no Express, no MongoDB, no JWT** — auth goes through a
custom `auth` port (`server/src/adapters/auth/`), secrets through `LocalSecretsProvider`
(`server/src/adapters/secrets/local.ts`). See `examples.md` for unsafe/safe code pairs,
`checklists.md` for quick checklists, `references.md` for all sources.

---

## Core Philosophy — Confidence-Based Review

Before flagging any issue, **trace the data flow** and confirm the input source.

| Confidence | Criteria | Action |
|------------|----------|--------|
| **HIGH** | Vulnerable pattern + attacker-controlled input confirmed | **Report** with file, line, exploit, and fix |
| **MEDIUM** | Vulnerable pattern, input source unclear | **Note** for manual verification |
| **LOW** | Theoretical / best-practice deviation | **Do not report** — mention only if asked |

**Do NOT flag**: test files, dead code, server-controlled values (env vars, config constants,
hardcoded script constants passed to `dangerouslySetInnerHTML`), framework-mitigated patterns
(React JSX escaping, Drizzle query-builder parameterization), development-only code gated by
`NODE_ENV`.

> **Golden rule**: `fetch(process.env.API_URL)` = safe. `fetch(req.query.url)` = vulnerable.
> Always ask: **"Can an attacker control this value?"**

This section is for code **review** (`implementer`, `test-writer`, `architecture-reviewer`,
`pr-self-review`). For **design-time** consumers who don't have code to trace yet — see below.

---

## Design-Time Threat Checklist (for spec/plan authors)

`spec-creator` and `implementation-planner` don't review existing code — they write
requirements and plans before code exists. A confidence-based review heuristic doesn't apply;
walk this checklist instead when a spec or plan touches a new endpoint, table, or external call:

- **Trust boundary** — what data in this feature crosses from an untrusted source (PR diff,
  PR description, uploaded file, another repo's code, a linked issue body)? Every one of those
  MUST be named in the spec as untrusted.
- **Authorization** — does every new/changed route resolve `{ workspaceId, userId }` via
  `getContext()` and filter its query by `workspaceId`? Don't write a requirement like "fetch
  the skill by id" without also stating "scoped to the caller's workspace."
  Do not write a JWT- or session-based auth requirement — this repo has no login flow
  (`LocalNoAuthProvider`); auth requirements should name the `auth` port, not a token scheme.
- **Rate limiting** — does this endpoint call an LLM, accept an upload, or do anything
  expensive? Name a rate limit in the spec, don't leave it to the implementer to guess.
- **Logging** — does this feature touch a secret, token, or PII-shaped field? State explicitly
  that it must NOT appear in Pino output.
- **Storage** — new DB column or table? Note whether it holds anything secret-shaped (it
  shouldn't — secrets go through `LocalSecretsProvider`, never a DB column, per
  `server/AGENTS.md`).
- **Untrusted content reaching an LLM prompt** — if this feature adds a new input that flows
  into `assemblePrompt()` (PR comments, linked-issue bodies, imported skill bodies), the spec
  MUST require it go through `wrapUntrusted()`. Never write a requirement implying a
  keyword/regex filter for prompt injection — see Agentic AI Security below.

---

## Split OWASP Framework

This app is a Fastify REST/SSE API with a Next.js SPA client, not a server-rendered app with
login forms — general Web Top 10 categories like "Authentication Failures" mostly don't apply
yet. Use two frameworks, one per surface:

| Surface | Framework | Why |
|---------|-----------|-----|
| `server/` (API) | **OWASP API Security Top 10 (2023)** | BOLA, excessive data exposure, resource consumption, mass assignment — the actual API-surface risks here |
| `client/` (Next.js/React) | **OWASP Top 10:2025 (Web)**, trimmed | XSS/injection and client supply chain still apply; login/session categories mostly don't (no auth flow exists yet) |

### API Security Top 10 (2023) — server/ mapping

| # | Category | Key Risk in This Stack |
|---|----------|------------------------|
| API1 | Broken Object Level Authorization (BOLA) | Route resolves an id without scoping the query by `workspaceId` |
| API2 | Broken Authentication | N/A today — `LocalNoAuthProvider` is single-tenant MVP; flag only if a real auth flow ships without rate limiting/lockout |
| API3 | Broken Object Property Level Authorization | Zod response schema exposes a field the client shouldn't see |
| API4 | Unrestricted Resource Consumption | Missing/loose `@fastify/rate-limit` override on an LLM-calling or upload route |
| API5 | Broken Function Level Authorization | Admin/privileged action reachable without a role check (N/A until roles exist) |
| API6 | Unrestricted Access to Sensitive Business Flows | Review-run or import endpoints callable without limits, enabling cost/abuse |
| API7 | Server Side Request Forgery | Any adapter that fetches a URL derived from PR/repo content (webhooks, linked images) |
| API8 | Security Misconfiguration | Helmet/CORS/error-handler registration order wrong, verbose errors in prod |
| API9 | Improper Inventory Management | Undocumented/forgotten route bypasses the module registry pattern |
| API10 | Unsafe Consumption of APIs | Trusting a third-party API (GitHub, LLM provider) response without validation |

### Web Top 10:2025 — client/ mapping (trimmed)

Only these categories are live risks in `client/` today — the rest (session/auth-heavy
categories) don't apply until a real login flow exists:

| Category | Key Risk in This Stack |
|----------|------------------------|
| Injection (XSS) | `dangerouslySetInnerHTML` fed anything other than a hardcoded constant; unvalidated `href`/`src` from PR/repo content |
| Security Misconfiguration | `NEXT_PUBLIC_*` env var accidentally holding a secret |
| Software Supply Chain Failures | Compromised npm package in `client/package.json` |

---

## API1 — Broken Object Level Authorization (was A01)

- **Deny by default** — every route resolves tenancy via `getContext(app.container, req)`
  (`server/src/modules/_shared/context.ts`), which returns `{ workspaceId, userId }` from the
  `auth` port. There is no route that skips this — it's not optional middleware, it's a
  function every handler calls.
- **Always scope by `workspaceId`** at the service/query layer, not just the route — being
  authenticated does not mean authorized for another workspace's rows. A route param `:id`
  alone is never sufficient; the WHERE clause must include `workspaceId`.
- A resource that exists but belongs to another workspace should 404, not 403 — don't leak
  existence across workspaces.
- Next.js route guards are UX only — **the server must enforce all access control**.
- This is OWASP API Security Top 10 #1 (BOLA) — the highest-frequency real-world API
  vulnerability class, and the one most likely to show up as a missed `workspaceId` filter in
  a new query.

---

## API8 — Security Misconfiguration (was A02)

- **Helmet**: `await app.register(helmet)` with no options is correct for a JSON-only API
  (`server/src/app.ts:88-90`) — default CSP is fine since there's no HTML to protect. Only add
  CSP config if `server/` starts serving HTML.
- **CORS**: `await app.register(cors, { origin: [config.webOrigin], credentials: true })`
  (`app.ts:91`) — single explicit origin from config, never `origin: '*'` or `origin: true`
  with `credentials: true`.
- **Registration order matters**: helmet → cors → SSE → multipart → rate-limit, all registered
  BEFORE feature modules (`server/AGENTS.md`), so every module inherits them. A module
  registered ahead of these plugins would bypass them.
- **Error handler**: `app.setErrorHandler` (`app.ts:120-168`) returns the generic
  `{ error: { code, message, details } }` envelope; stack traces only ever go to `app.log`,
  never to the response, in any environment.
- **`NEXT_PUBLIC_*` env vars**: public in the client bundle (Next.js's equivalent of Vite's
  `VITE_*`) — never put a secret behind this prefix (`client/src/lib/api.ts:6` for the only
  current usage — an API base URL, not a secret).
- **Postgres**: require auth + TLS in production, never expose the container port to the
  internet outside `docker-compose.yml`'s local dev network.
- **Body size**: `Fastify({ bodyLimit: 1_048_576 })` (`app.ts:48-50`) — global 1MB cap on top
  of the multipart plugin's own 2MB file cap.

---

## API3 — Injection & Query Safety (was A05, Drizzle half)

### Drizzle / Postgres

- **Values interpolated into `sql\`...\`` are auto-parameterized** — `` sql`WHERE repo_id = ${repoId}` `` is safe by construction; Drizzle binds it as `$1`, never string-concatenates.
- **`sql.raw()` does NOT escape anything** — never pass attacker-controlled input to it. This
  repo currently has zero `sql.raw()` call sites in `server/src` — keep it that way; if one is
  ever added, the input must be validated against an allowlist first.
- **`sql.identifier()` / dynamic column names/aliases** built from user input (e.g. a
  `?sort=column` query param) are unsafe the same way — validate against an allowlist of known
  column names before use. This is the exact surface of
  [GHSA-gpj5-g38j-94v9](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9).
- Ordinary query-builder calls (`.select().where(eq(...))`) parameterize automatically — no
  manual escaping needed; prefer them over `sql\`\`` whenever possible.
- `pgvector` columns (`vector('embedding', { dimensions: 1536 })`) follow the same rules —
  no distance-operator raw-SQL construction currently exists in this repo.

### Cross-Site Scripting (XSS) — client/

- React auto-escapes JSX — that's the default safety net.
- The one `dangerouslySetInnerHTML` in this repo (`client/src/app/layout.tsx:21`) injects a
  hardcoded theme-no-flash script constant — not user/DB content. That's the safe pattern.
  **Flag** any new `dangerouslySetInnerHTML` that receives PR content, repo content, or
  anything from the API response without DOMPurify sanitization first.
- Validate URLs before `href`/`src` if ever rendering a PR- or repo-derived link — reject
  `javascript:`, allow only `http:`/`https:`.

### Command Injection

- `server/src/adapters/codeindex/ripgrep.ts:60` — `spawn(rg, ['--line-number', ..., pattern, root])` —
  correct pattern: array-form `spawn`/`execFile`, never `exec()` with a template string.
  Arguments (including the search `pattern`, which can be attacker-influenced via a query) are
  passed directly to the process, not through a shell — no shell metacharacter injection
  possible. Keep any future subprocess call (git, gh CLI) in this array-argument form.

---

## API4 — Unrestricted Resource Consumption (was A06, rate limiting)

Actual config (`server/src/app.ts:97-101`, `server/AGENTS.md`):

| Endpoint | Limit |
|----------|-------|
| Global default | 120 req / 1 min |
| `POST /pulls/:id/review` and other expensive/LLM-calling routes | tighter per-route override |
| `/health`, `/health/ready`, SSE routes | exempt (`config: { rateLimit: false }`) |
| All routes | disabled entirely when `NODE_ENV=test` |

- **LLM-calling routes**: sanitize/cap any prompt-shaped input length, set request timeouts,
  never expose provider API keys to the client, keep runs auditable via the existing
  `run-logger` / trace-builder.
- New expensive endpoint (upload, review run, import) → give it a route-level
  `config: { rateLimit: { max, timeWindow } }` override tighter than the 120/min global.

---

## API2 / Secrets — Cryptographic & Secrets Handling (was A04)

- **Secrets chokepoint**: `LocalSecretsProvider` (`server/src/adapters/secrets/local.ts`) is
  the **only** place `process.env` is read for a secret. Stored (UI-entered) values win over
  env vars. Every consumer calls `container.secrets.get(key)` — never
  `process.env.OPENAI_API_KEY` inline in a service. Adding a new secret key means wiring it
  through `SecretsProvider`, not inlining a new `process.env.X` read.
- **Auth / passwords / JWT**: **not applicable today.** `LocalNoAuthProvider`
  (`server/src/adapters/auth/local.ts`) always resolves the same seeded user/workspace —
  single-tenant MVP, no login flow, no password hashing, no token signing anywhere in this
  repo. Do not write or flag JWT/bcrypt-shaped requirements or findings; this section is a
  placeholder for when a real auth port ships, not a live rule today.
- **Transit**: HTTPS in production, `Strict-Transport-Security` via Helmet.
- **At rest**: never store a secret in a DB column — it goes through `LocalSecretsProvider`,
  full stop.

---

## API9 / Integrity — Mass Assignment & File Upload (was A08)

- **Mass assignment prevention**: every route validates `req.body` against an explicit Zod
  schema (`CreateSkillBody`, `UpdateSkillBody`, etc. in `server/src/modules/skills/routes.ts`)
  via `fastify-type-provider-zod`'s `validatorCompiler`. The schema IS the field allowlist —
  never widen a handler to accept `req.body` unchecked, and never spread `req.body` into a
  Drizzle `.insert()`/`.values()` call.
- **File upload** — the one real multipart route, `POST /skills/import`
  (`server/src/modules/skills/routes.ts:97-111`):
  - `@fastify/multipart` registered with `{ limits: { fileSize: 2 * 1024 * 1024, files: 1 } }`
    (`app.ts:93-95`) — size/count capped at plugin registration, not per-route.
  - Extension allowlist (`.md`, `.markdown`, `.zip`) checked on the filename — reject anything
    else with `BadRequestError`.
  - Zip handling reads **one named entry into memory** (`SKILL.md` or the first root-level
    `.md`) and never calls an `extractAllTo`-style disk write
    (`server/src/modules/skills/service.ts:211-260`) — every other entry is only *listed* in
    `skippedFiles`, its bytes are never extracted. This eliminates zip-slip by construction:
    there is no path to sanitize because nothing is ever written to disk from this path.
  - New upload routes should follow the same "read into memory, allowlist by extension" shape
    unless there's a specific reason to write to disk — and if one does write to disk, it needs
    the traversal guard (`path.basename()` + `path.resolve()` prefix check) that this route
    currently avoids needing entirely.

---

## API8 / Logging — Logging and Alerting (was A09)

**Log these**: run start/complete/fail events, rate-limit hits, 5xx errors, validation
failures worth investigating.
**Never log**: secrets, tokens, full request bodies wholesale.

- **Gap identified — fix this**: Fastify's Pino `logger` config
  (`server/src/app.ts:51-61`) currently has **no `redact` option**. Nothing logs
  `req.headers`/`req.body` wholesale today, so this is latent, not yet exploited — but it's a
  real, actionable gap. Add:
  ```ts
  logger: {
    level: config.logLevel,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    // ...existing transport config
  }
  ```
- Use structured JSON logging in production (already the default outside `development`, where
  `pino-pretty` is used instead).
- If a route ever logs `req.body` for debugging, redact secret-shaped fields
  (`password`, `token`, `secret`, `authorization`) first — see `examples.md`.

---

## API8 / Errors — Mishandling of Exceptional Conditions (was A10)

- **Fail-closed by construction**: `app.setErrorHandler` (`server/src/app.ts:120-168`) is
  registered BEFORE feature modules, so every module inherits it. It branches on Zod validation
  errors (422), response-serialization failures (never leaks the raw object, generic 500),
  `AppError` subclasses (their own status code), and a final catch-all (`err.statusCode ?? 500`)
  — every branch returns a response, none of them call `next()`/fall through to defaults.
- A service throwing `AppError` (`platform/errors.ts`) is the correct way to signal a
  client-facing error with a specific status — don't hand-roll `reply.status(...).send(...)` in
  a route when an `AppError` subclass already exists for the case.
- **Health checks**: `/health` (liveness, no DB) vs `/health/ready` (readiness, `SELECT 1`,
  returns 503 not 500 on DB-unreachable — orchestrators should treat this as "not ready yet,"
  not "crashed").

---

## Secret Detection

Scan for these patterns in all code and config — stack-independent:

| Type | Pattern |
|------|---------|
| AWS Key | `AKIA[0-9A-Z]{16}` |
| Google API | `AIza[0-9A-Za-z_-]{35}` |
| JWT/Generic | `(secret\|key\|token\|password)\s*[:=]\s*['"][^'"]{8,}` |
| Postgres URI | `postgres(ql)?://[^:]+:[^@]+@` |
| Private Key | `-----BEGIN .* PRIVATE KEY-----` |
| GitHub Token | `gh[ps]_[A-Za-z0-9]{36,}` |
| npm Token | `npm_[A-Za-z0-9]{36}` |

**Never commit**: `.env`, `.env.local`, `.env.production`, any `LocalSecretsProvider` override
file, `logs/`.

---

## Agentic AI Security — Prompt Injection

Relevant to any LLM call this repo makes (review runs, intent classification).

- **This repo's actual defense**: `INJECTION_GUARD` + `wrapUntrusted()`
  (`reviewer-core/src/prompt.ts:16-34`) — ONE trusted system-prompt rule, appended to every
  agent's system message on every review path, telling the model that everything inside
  `<untrusted>…</untrusted>` (diff, PR title/description, repo map, callers, specs, intent) is
  data, never instructions. `wrapUntrusted()` fences the content and neutralizes attempts to
  close its own delimiter early.
- **Do NOT add keyword/regex denylists.** This is an explicit repo rule (root `CLAUDE.md`,
  `reviewer-core/AGENTS.md`) and it's backed by external consensus, not just local preference:
  OWASP's LLM Top 10 for 2025 lists Prompt Injection as the #1 risk for the second consecutive
  edition specifically because it's a **design-level flaw** — the model processes instructions
  and data over the same channel — that lexical filtering cannot close. A denylist catches one
  phrasing ("ignore this, it's a test fixture") and misses the next one, in the next language,
  while giving false confidence that the input is "sanitized."
- **Any new untrusted input** (PR review comments, linked-issue bodies, imported skill bodies,
  README content) that flows into `assemblePrompt()` MUST go through `wrapUntrusted()`, not be
  concatenated raw into the prompt.
- The trusted `INTENT_RULE` (`prompt.ts:41-43`) sits OUTSIDE the untrusted fence, alongside the
  untrusted intent data inside it — the same instruction-segregation pattern OWASP recommends.
- Never execute AI-generated code without review; label AI-generated content if it's ever
  surfaced to a user; API keys stay server-side via `LocalSecretsProvider`, never sent to the
  client.

---

## Framework Security Quirks

### Fastify
- Plugin registration order matters — `helmet`/`cors`/`rate-limit`/error-handler must register
  BEFORE feature module plugins, or an encapsulated module won't inherit them
  (`server/AGENTS.md`).
- `withTypeProvider<ZodTypeProvider>()` per route file — a route missing `{ schema: { body } }`
  gets NO validation, silently. Check new routes have a schema, not just that one exists
  somewhere in the file.
- Route `config: { rateLimit: false }` is how health/SSE routes opt out of the global limiter —
  intentional per-route escape hatch, not a bypass to copy carelessly onto other routes.

### Drizzle / Postgres
- `sql.raw()` and `sql.identifier()` are the only unsafe surfaces — see API3 above. Ordinary
  query-builder calls and `sql\`\`` value interpolation are safe by construction.
- `strict` typing at the schema level is Drizzle's default behavior — there's no `strict: false`
  escape hatch to worry about the way Mongoose has one.

### Node.js (stack-independent)
- Prototype pollution via `__proto__`/`constructor.prototype` — validate object keys on
  anything parsed from untrusted JSON.
- `JSON.parse()` throws on malformed input — always wrap in try-catch (or let Zod's `.parse()`
  own the validation, since most bodies here already go through a Zod schema).
- `RegExp(userInput)` enables ReDoS — escape special characters before constructing a regex
  from user input (search endpoints, filters).
- `path.join()` with user input allows traversal — use `path.basename()` first if a path is
  ever built from user input (not currently needed — see the zip-import "never write to disk"
  pattern above, which sidesteps this entirely).

### React / Next.js
- `dangerouslySetInnerHTML` bypasses escaping — require DOMPurify for anything except a
  hardcoded, server-authored constant.
- `href={userUrl}` allows `javascript:` XSS — validate protocol if ever rendering a PR- or
  repo-derived URL.
- `NEXT_PUBLIC_*` env vars are public in the client bundle — never prefix a secret with it.

---

## Security Review Process

1. **Detect context** — API endpoint, workspace-scoping logic, Drizzle query, file handling,
   frontend, config, prompt assembly, or dependency change.
2. **Load relevant rules** — Only the API/Web Top 10 categories that apply to this context.
3. **Trace data flow** — Where does the input come from? Is it attacker-controlled?
4. **Check upstream controls** — `getContext()` already scoping this? Zod schema already
   validating this? `wrapUntrusted()` already fencing this?
5. **Verify exploitability** — Can an attacker actually reach and control this?
6. **Report HIGH confidence only** — Include file, line, exploit scenario, specific fix.

---

## Severity Classification

| Severity | Criteria | Stack Examples |
|----------|----------|-----------------|
| **CRITICAL** | Direct exploit, no auth required | `sql.raw()`/`sql.identifier()` fed unvalidated input, hardcoded prod secret, route missing `getContext()` scoping entirely |
| **HIGH** | Exploitable with conditions | BOLA — query missing `workspaceId` filter on an otherwise-authorized route, PR/repo content flowing into `dangerouslySetInnerHTML` unsanitized |
| **MEDIUM** | Specific conditions, limited impact | Missing/loose per-route rate limit on an LLM-calling endpoint, verbose prod error, new untrusted input not routed through `wrapUntrusted()` |
| **LOW** | Defense-in-depth | Missing Pino `redact` config (latent, not yet exploited), sequential ID exposure |

---

## ASVS 5.0 Quick Reference

**Level 1 (All Apps)**: session/request entropy, HTTPS, server-side (Zod) validation, generic
error messages, rate limiting on expensive endpoints.

**Level 2 (Sensitive)**: + comprehensive security logging, schema-based input validation
(already the default here via Zod), CSRF protection if a session-based flow is ever added.

**Level 3 (Critical)**: + documented threat model, anomaly detection, penetration testing,
supply chain verification. Not currently applicable to this MVP's threat model — revisit if the
auth model changes from single-tenant to multi-tenant with real credentials.
