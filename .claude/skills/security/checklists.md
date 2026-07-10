# Security Checklists — Quick Reference

Compact checklists for common security scenarios in DevDigest's actual stack (Fastify, Drizzle,
Postgres, Next.js — no Express/MongoDB/JWT). Use these for self-review before committing or
creating a PR.

---

## Pre-Commit Security Self-Review

Run through this before every commit that touches `server/src`, adapters, or user/PR input
handling.

- [ ] No hardcoded secrets, passwords, or API keys in code
- [ ] No `.env` files or `LocalSecretsProvider` override file staged for commit
- [ ] User/PR input is validated server-side via a Zod schema (not just client-side)
- [ ] No `sql.raw()`/`sql.identifier()` fed unvalidated input (Drizzle queries use `sql\`\``
      value interpolation or the query builder instead)
- [ ] Error responses don't leak stack traces or internal paths (goes through
      `app.setErrorHandler`, not a hand-rolled catch)
- [ ] Every route resolves `{ workspaceId, userId }` via `getContext()` and every query it
      calls filters by `workspaceId`
- [ ] File uploads have an extension allowlist and don't write attacker-controlled paths to disk
- [ ] No `dangerouslySetInnerHTML` fed anything but a hardcoded constant, without DOMPurify
- [ ] No `exec()`/shell-string subprocess calls with user input (`execFile`/`spawn` array-form
      only)
- [ ] New untrusted input reaching an LLM prompt goes through `wrapUntrusted()`
- [ ] Sensitive data is redacted in log output (Pino `redact`, not manual field-checking)

---

## New API Endpoint Checklist

When adding a new Fastify route (`modules/<name>/routes.ts`).

### Authorization
- [ ] Route calls `getContext(app.container, req)` and gets `{ workspaceId, userId }`
- [ ] Service-layer query filters by `workspaceId` — not just the route param `:id`
- [ ] Resource in another workspace 404s, doesn't 403 (don't leak existence)
- [ ] Rate limiter applied if the route is expensive (LLM call, upload, review run) —
      `config: { rateLimit: { max, timeWindow } }` tighter than the 120/min global

### Input Validation
- [ ] `{ schema: { body, params, querystring } }` set with a Zod schema — this IS the field
      allowlist, don't accept `req.body` unchecked
- [ ] Route registered via `app.withTypeProvider<ZodTypeProvider>()`
- [ ] Only expected fields extracted/used — never spread `req.body` into a Drizzle
      `.insert()`/`.values()` call

### Error Handling
- [ ] Errors thrown as `AppError` subclasses (`platform/errors.ts`), not hand-rolled
      `reply.status().send()`
- [ ] Resource-not-found returns 404 via `NotFoundError`, not a generic 500
- [ ] No response ever includes `err.stack` or a raw caught object

### Response Security
- [ ] Response schema only includes fields the client should see
- [ ] Secrets never appear in a response body (they live in `LocalSecretsProvider`, not a
      DB column, so this should be structurally impossible — verify nothing changed that)

---

## New Dependency Checklist

Before adding a package to `server/package.json` or `client/package.json`.

- [ ] **Need check**: Can this be done with an existing dependency or a built-in Node/Fastify
      API?
- [ ] **Audit**: `pnpm audit` shows no known vulnerabilities for this package
- [ ] **Maintenance**: Last commit within 6 months, responsive to issues
- [ ] **Popularity**: Reasonable download count (>10K weekly for production deps)
- [ ] **Scope**: Package only accesses what it needs (no unnecessary network/fs/env access)
- [ ] **Name**: Package name is correct (not a typosquat)
- [ ] **License**: Compatible license (MIT, Apache 2.0, BSD — avoid GPL for proprietary code)
- [ ] **Lockfile**: pnpm lockfile updated and committed after install — each package
      (`server/`, `client/`, `reviewer-core/`) owns its own, this is NOT a workspace

---

## File Upload Checklist

When implementing or modifying multipart upload functionality (`@fastify/multipart`).

### Configuration
- [ ] Size/count limits set at plugin registration (`{ limits: { fileSize, files } }`), not
      left to defaults
- [ ] Extension allowlist checked on the filename before any parsing
- [ ] Prefer reading into memory over writing to disk — if disk write is genuinely needed,
      see below

### If writing to disk (avoid unless necessary — the current upload route never does)
- [ ] Filename generated server-side, never `data.filename` used directly as a path segment
- [ ] `path.basename()` strips any directory components before use
- [ ] Resolved path validated to stay within the intended upload directory before any
      read/write/delete

### Archive handling (zip/tar)
- [ ] Only read specific named entries into memory — never `extractAllTo`-style bulk disk
      extraction with attacker-controlled entry names
- [ ] Non-consumed entries are listed (for user visibility), never extracted

---

## Prompt-Injection Checklist

When adding a new input that reaches `assemblePrompt()` (`reviewer-core/src/prompt.ts`).

- [ ] Input is wrapped with `wrapUntrusted(label, content)`, not concatenated raw
- [ ] No keyword/regex denylist added anywhere in the prompt-assembly path — the defense is
      the single `INJECTION_GUARD` rule, uniformly applied
- [ ] Any trusted instruction related to this input (like `INTENT_RULE`) sits OUTSIDE the
      `wrapUntrusted` fence, not mixed into the untrusted content
- [ ] If the content has a natural length ceiling risk (PR description, comment body), it's
      capped before assembly (see `MAX_PR_DESCRIPTION_CHARS` for the existing pattern)

---

## Deployment Security Checklist

Before deploying to production.

### Environment
- [ ] `NODE_ENV=production` is set
- [ ] All secrets entered via the settings UI or environment, read only through
      `LocalSecretsProvider` — never hardcoded
- [ ] `.env.example` doesn't contain real secrets

### HTTP Security
- [ ] Helmet enabled (default config is fine for this JSON-only API)
- [ ] CORS configured with the explicit production `webOrigin`, not a wildcard
- [ ] HTTPS enforced (TLS termination at load balancer/reverse proxy)
- [ ] `@fastify/rate-limit` active (it's disabled only in `NODE_ENV=test`)
- [ ] `bodyLimit` set on the Fastify instance (1MB default in this repo)

### Database
- [ ] Postgres requires auth + TLS in production
- [ ] Postgres port not exposed to the internet outside the local dev `docker-compose.yml`
      network
- [ ] Connection string read via config/secrets, not hardcoded
- [ ] Migrations applied (`pnpm db:migrate`) — NOT run automatically on boot in this repo

### Error Handling
- [ ] `app.setErrorHandler` active and registered before feature modules
- [ ] Stack traces never appear in a response, in any `NODE_ENV`
- [ ] `/health` (liveness) and `/health/ready` (readiness, DB check) both respond correctly

### Logging & Monitoring
- [ ] Pino `redact` configured for `authorization`/`cookie` header paths
- [ ] Structured JSON logging active (non-development)
- [ ] Log storage not publicly accessible

### Dependencies
- [ ] `pnpm audit` passes with no critical/high vulnerabilities in each package
      (`server/`, `client/`, `reviewer-core/` — each has its own lockfile)
- [ ] No unnecessary dev dependencies bundled into production

---

## Security Incident Response Checklist

If a security vulnerability is discovered in production. Stack-independent.

### Immediate (0-1 hours)
- [ ] Assess severity and scope of the vulnerability
- [ ] Determine if it's actively being exploited (check logs)
- [ ] If credentials exposed: rotate all affected secrets in `LocalSecretsProvider` immediately
- [ ] If data breach: identify affected records/workspaces
- [ ] Create a private issue/ticket to track the incident

### Short-term (1-24 hours)
- [ ] Develop and test a fix
- [ ] Deploy the fix to production
- [ ] Verify the fix resolves the vulnerability
- [ ] Review logs for any exploitation attempts

### Follow-up (1-7 days)
- [ ] Conduct root cause analysis
- [ ] Add an automated test that would catch this vulnerability
- [ ] Update this skill's checklists if a gap was found
- [ ] Review similar code (other routes, other adapters) for the same pattern

---

*Use these checklists as living documents. Update them as new patterns emerge or the stack
evolves.*
