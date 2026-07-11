# Security Code Examples — Unsafe vs Safe Patterns

Each section shows a vulnerable pattern and its secure replacement, tailored to DevDigest's
actual stack (Fastify 5, Drizzle ORM + Postgres 16, Next.js 15/React 19, Zod). No Express,
MongoDB, or JWT examples — this repo doesn't run any of those.

---

## 1. Drizzle / Postgres SQL Injection

### UNSAFE — `sql.raw()` with unvalidated input

```typescript
// GET /api/findings?sort=title — attacker sends: sort=title; DROP TABLE findings;--
export async function listFindings(sortColumn: string) {
  return db.execute(sql.raw(`SELECT * FROM findings ORDER BY ${sortColumn}`)) // sql.raw does NOT escape
}
```

### SAFE — value interpolation, or an allowlist for identifiers

```typescript
// Values: sql`` auto-parameterizes anything interpolated with ${}
export async function findingsForRepo(repoId: string) {
  return db.execute(sql`SELECT * FROM findings WHERE repo_id = ${repoId}`) // bound as $1, safe
}

// Dynamic identifiers (column/alias names) are NOT auto-safe — validate against an allowlist
const SORTABLE_COLUMNS = new Set(['title', 'severity', 'created_at'])
export async function listFindings(sortColumn: string) {
  if (!SORTABLE_COLUMNS.has(sortColumn)) throw new BadRequestError('Invalid sort column')
  return db.select().from(t.findings).orderBy(sql.identifier(sortColumn))
}

// Best default — the query builder parameterizes automatically, prefer it over sql``
export async function findingsForRepo(repoId: string) {
  return db.select().from(t.findings).where(eq(t.findings.repoId, repoId))
}
```

**Why it works:** `sql\`...\`` binds interpolated *values* as query parameters ($1, $2, …) —
safe by construction. `sql.raw()` and `sql.identifier()` do not parameterize; they're for
dynamic SQL text/identifiers and must only ever receive validated, allowlisted input. This repo
currently has zero `sql.raw()`/`sql.identifier()` call sites in `server/src` — keep it that way.

---

## 2. Cross-Site Scripting (XSS)

### UNSAFE — Rendering unsanitized HTML content

```tsx
// Finding rationale or PR description surfaced in the studio UI
function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div>
      <h3>{finding.title}</h3>
      {/* VULNERABLE if rationale ever contains PR-author-controlled markup */}
      <div dangerouslySetInnerHTML={{ __html: finding.rationale }} />
    </div>
  )
}
```

### SAFE — DOMPurify sanitization, or just let JSX escape it

```tsx
import DOMPurify from 'dompurify'

function FindingCard({ finding }: { finding: Finding }) {
  const safeRationale = useMemo(
    () => DOMPurify.sanitize(finding.rationale, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre'],
      ALLOWED_ATTR: [],
    }),
    [finding.rationale],
  )

  return (
    <div>
      <h3>{finding.title}</h3> {/* React auto-escapes this — safe by default */}
      <div dangerouslySetInnerHTML={{ __html: safeRationale }} />
    </div>
  )
}
```

**Why it works:** DOMPurify strips script tags, event handlers, and dangerous attributes; the
allowlist only permits known-safe elements. Compare with the repo's one actual
`dangerouslySetInnerHTML` usage (`client/src/app/layout.tsx:21`) — it injects a hardcoded
theme-no-flash script constant, never user/DB content. That's the safe end of this spectrum:
prefer a constant over sanitized user content whenever possible.

---

## 3. URL-Based XSS

### UNSAFE — Rendering a user/PR-provided URL without validation

```tsx
// Rendering a link from a PR description or repo README
function ExternalLink({ url, text }: { url: string; text: string }) {
  return <a href={url}>{text}</a>
}
```

### SAFE — Protocol validation

```tsx
function ExternalLink({ url, text }: { url: string; text: string }) {
  const safeUrl = useMemo(() => {
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol) ? url : '#'
    } catch {
      return '#'
    }
  }, [url])

  return (
    <a href={safeUrl} rel="noopener noreferrer" target="_blank">
      {text}
    </a>
  )
}
```

**Why it works:** `new URL('javascript:alert(1)')` parses successfully with
`protocol: 'javascript:'`, which the allowlist rejects. `rel="noopener noreferrer"` stops the
opened page from reaching back via `window.opener`.

---

## 4. Secrets Management

### UNSAFE — Reading `process.env` directly in a service

```typescript
// Anywhere outside adapters/secrets/local.ts
export class ReviewService {
  async run() {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) // bypasses the chokepoint
  }
}
```

### SAFE — Every consumer goes through `SecretsProvider`

```typescript
// server/src/adapters/secrets/local.ts — the ONLY place process.env is read for a secret
export class LocalSecretsProvider implements SecretsProvider {
  async get(key: SecretKey): Promise<string | undefined> {
    const stored = (await this.load())[key as string]   // UI-entered override wins
    if (stored) return stored
    return this.env[key as string]                        // fallback: env var
  }
}

// Every consumer — injected via the DI container, never `new OpenAI()` inline
export class ReviewService {
  constructor(private readonly secrets: SecretsProvider) {}
  async run() {
    const apiKey = await this.secrets.get('OPENAI_API_KEY')
    const client = new OpenAI({ apiKey })
  }
}
```

**Why it works:** A single chokepoint means one place to audit, rotate, or swap for a real
vault later — every call site is a `container.secrets.get(key)`, never a scattered
`process.env.X`. Adding a new secret means wiring a new key through `SecretsProvider`, not
adding a new `process.env` read somewhere in a service.

---

## 5. File Upload Validation

### UNSAFE — No allowlist, extracting an archive straight to disk

```typescript
// Hypothetical unsafe zip-import — do NOT copy this shape
async function importZip(buffer: Buffer) {
  const zip = new AdmZip(buffer)
  zip.extractAllTo('uploads/skills', true) // attacker-controlled entry names → zip-slip
}
```

### SAFE — Extension allowlist + read into memory, never write to disk

```typescript
// server/src/modules/skills/routes.ts — the actual multipart route
app.post('/skills/import', async (req) => {
  await getContext(app.container, req)
  const data = await req.file()
  if (!data) throw new BadRequestError('No file uploaded')
  const buf = await data.toBuffer()
  const lower = (data.filename ?? 'skill.md').toLowerCase()
  if (lower.endsWith('.zip')) return service.previewZip(buf)
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return service.previewMarkdown(data.filename!, buf.toString('utf8'))
  }
  throw new BadRequestError('Only .md, .markdown or .zip files are supported')
})

// server/src/modules/skills/service.ts — reads ONE entry into memory, never extracts to disk
async previewZip(buffer: Buffer): Promise<ImportPreview> {
  const zip = new AdmZip(buffer)
  const skipped: string[] = []
  let chosen: { name: string; content: string } | undefined
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue
    const base = e.entryName.split('/').pop()!.toLowerCase()
    if (base === 'skill.md' && !chosen) {
      chosen = { name: e.entryName, content: e.getData().toString('utf8') }
      continue
    }
    skipped.push(e.entryName) // recorded, but bytes NEVER extracted
  }
  // ...
}
```

Global size/count cap set at plugin registration, not per-route:

```typescript
// server/src/app.ts
await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } })
```

**Why it works:** Reading a single named zip entry into memory and never calling an
`extractAllTo`-style disk write eliminates zip-slip by construction — there is no
attacker-controlled path to sanitize, because nothing is ever written to disk from this route.
The extension allowlist rejects anything but `.md`/`.markdown`/`.zip` before any parsing
happens.

---

## 6. Broken Object Level Authorization (BOLA)

### UNSAFE — Resolving a resource by id param with no workspace scope

```typescript
app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
  const skill = await service.getById(req.params.id) // any workspace's skill, by guessing an id
  if (!skill) throw new NotFoundError('Skill not found')
  return skill
})
```

### SAFE — Every route resolves tenancy, every query scopes by it

```typescript
// server/src/modules/_shared/context.ts
export async function getContext(container: Container, req: FastifyRequest) {
  const [user, workspace] = await Promise.all([
    container.auth.currentUser(req),
    container.auth.currentWorkspace(req),
  ])
  return { workspaceId: workspace.id, userId: user.id }
}

// server/src/modules/skills/routes.ts
app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(app.container, req)
  const skill = await service.get(workspaceId, req.params.id) // service filters WHERE workspace_id = ...
  if (!skill) throw new NotFoundError('Skill not found') // 404 for "not mine" too — don't leak existence
  return skill
})
```

**Why it works:** `getContext()` is called on every route, and the service layer's query
includes `workspaceId` in its WHERE clause — an id from another workspace simply doesn't match
any row, so it 404s the same way a nonexistent id would. This is OWASP API Security Top 10 #1
(BOLA), the highest-frequency real API vulnerability class.

---

## 7. Error Handling — Stack Trace Leak

### UNSAFE — Exposing internals to the client

```typescript
app.setErrorHandler((err, req, reply) => {
  reply.status(500).send({
    error: (err as Error).message,
    stack: (err as Error).stack,       // full file paths, line numbers, dependency versions
    query: req.query,                   // could echo back malicious input
  })
})
```

### SAFE — Generic envelope to the client, full detail to the logger

```typescript
// server/src/app.ts — the actual handler, registered BEFORE feature modules
app.setErrorHandler((err: unknown, _req, reply) => {
  if (hasZodFastifySchemaValidationErrors(err)) {
    reply.status(422).send({
      error: { code: 'validation_error', message: 'Request validation failed', details: err.validation },
    })
    return
  }
  if (isResponseSerializationError(err)) {
    app.log.error({ err }, 'response serialization failed') // never leak the raw object
    reply.status(500).send({ error: { code: 'internal_error', message: 'Internal error' } })
    return
  }
  if (err instanceof AppError) {
    reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } })
    return
  }
  app.log.error(err) // full detail, server-side only
  const e = err as { statusCode?: number; message?: string }
  reply.status(e.statusCode ?? 500).send({ error: { code: 'internal_error', message: e.message ?? 'Internal error' } })
})
```

**Why it works:** Every branch sends the structured `{ error: { code, message, details } }`
envelope to the client and full detail only to `app.log` — there is no code path that echoes a
raw stack trace or object into the HTTP response, in any environment.

---

## 8. CORS Configuration

### UNSAFE — Wildcard with credentials

```typescript
await app.register(cors, { origin: '*', credentials: true })          // browsers reject this combo, but wrong mindset
await app.register(cors, { origin: true, credentials: true })          // reflects any origin — even worse
```

### SAFE — Single explicit origin

```typescript
// server/src/app.ts — the actual config
await app.register(cors, { origin: [config.webOrigin], credentials: true })
```

**Why it works:** Only the configured `webOrigin` can make credentialed cross-origin requests.
No reflection, no wildcard — an explicit allowlist of exactly one origin for this single-client
API.

---

## 9. Command Injection

### UNSAFE — Shell execution with attacker-influenced input

```typescript
import { exec } from 'child_process'

// Attacker-controlled search pattern reaches a shell string
function search(pattern: string, root: string) {
  exec(`rg --line-number "${pattern}" ${root}`, (err, stdout) => { /* ... */ }) // pattern could be: "; rm -rf /"
}
```

### SAFE — Array-argument `spawn`/`execFile`, no shell involved

```typescript
// server/src/adapters/codeindex/ripgrep.ts — the actual pattern in this repo
import { spawn } from 'node:child_process'

function search(pattern: string, root: string) {
  const proc = spawn('rg', ['--line-number', '--no-heading', '--color=never', pattern, root])
  // pattern and root are passed as literal argv entries — never interpreted by a shell
}
```

**Why it works:** Array-form `spawn`/`execFile` passes each argument directly to the process;
shell metacharacters (`;`, `|`, `&&`, backticks) inside `pattern` are treated as literal text,
not shell syntax. This is already the pattern used for the one subprocess call in this repo —
keep any future one (git, gh CLI) in the same shape.

---

## 10. Rate Limiting

### UNSAFE — No limit on an LLM-calling or upload endpoint

```typescript
app.post('/pulls/:id/review', async (req) => { /* triggers an LLM run, no limit */ })
```

### SAFE — Global default + tighter per-route override

```typescript
// server/src/app.ts — global default
if (config.nodeEnv !== 'test') {
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' })
}

// per-route override on an expensive endpoint
app.post(
  '/pulls/:id/review',
  { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
  async (req) => { /* ... */ },
)

// health checks opt out entirely — not a bypass to copy elsewhere
app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }))
```

**Why it works:** `@fastify/rate-limit` applies the 120/min global by default; a route-level
`config.rateLimit` override tightens (or disables) it per-route. LLM-calling and upload routes
should always get a tighter override than the global default given their cost.

---

## 11. Input Validation & Mass Assignment Prevention

### UNSAFE — Trusting `req.body` without a schema, or spreading it into an insert

```typescript
app.post('/skills', async (req) => {
  // No schema — client could send { name, description, workspaceId: 'someone-elses-workspace' }
  const skill = await db.insert(t.skills).values(req.body as any)
  return skill
})
```

### SAFE — Zod schema as the field allowlist

```typescript
// server/src/modules/skills/routes.ts — the actual pattern
const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType,
  body: z.string().min(1),
  enabled: z.boolean().optional(),
})

app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
  const { workspaceId } = await getContext(app.container, req)
  // req.body is now typed AND validated — only these fields exist, workspaceId comes from context, not the body
  const skill = await service.create(workspaceId, req.body)
  reply.status(201)
  return skill
})
```

**Why it works:** `fastify-type-provider-zod`'s `validatorCompiler` (wired once in
`server/src/app.ts:65`) rejects any request whose body doesn't match `CreateSkillBody` with a
422 before the handler even runs — the schema IS the allowlist. `workspaceId` is never taken
from the client-supplied body; it always comes from `getContext()`.

---

## 12. Sensitive Data in Logs

### UNSAFE — No redaction on the request logger

```typescript
// server/src/app.ts — current config, missing redact
const app = Fastify({
  logger: { level: config.logLevel }, // no `redact` — a future hook logging req.headers/body would leak secrets
})
```

### SAFE — Explicit `redact` paths

```typescript
const app = Fastify({
  logger: {
    level: config.logLevel,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    transport: config.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
})
```

**Why it works:** Pino replaces matched paths with `[REDACTED]` before the log line is emitted
— cheap (~2% overhead) insurance against a future hook or handler that logs `req.headers`/`body`
wholesale. Nothing in this repo does that today, which is exactly why this gap is easy to miss
in review — it's not exploited yet, but it's one added debug log away from leaking a bearer
token.

---

## 13. ReDoS via Unescaped Regex

### UNSAFE — User input straight into `RegExp`

```typescript
// Search endpoint — attacker sends: q = "(a+)+"
app.get('/skills', async (req) => {
  const pattern = new RegExp(req.query.q as string, 'i') // catastrophic backtracking
  return db.select().from(t.skills).where(sql`${t.skills.name} ~* ${pattern.source}`)
})
```

### SAFE — Escape special characters, cap input length

```typescript
const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

app.get('/skills', { schema: { querystring: z.object({ q: z.string().max(100).optional() }) } }, async (req) => {
  const q = req.query.q
  if (!q) return service.list(workspaceId)
  const safe = escapeRegex(q)
  return db.select().from(t.skills).where(ilike(t.skills.name, `%${safe}%`)).limit(20)
})
```

**Why it works:** `escapeRegex` neutralizes regex metacharacters before they reach the engine —
no attacker-controlled pattern can be crafted. The Zod `.max(100)` on the query param and
`.limit(20)` on the query add defense in depth against length- and volume-based abuse
independent of the regex concern.
