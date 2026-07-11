# Security Skill — References and Sources

All sources used to build this security skill, organized by category. Retargeted 2026-07-10 for
DevDigest's actual stack (Fastify 5 / Drizzle+Postgres 16 / Next.js 15 / Zod) — see
`docs/todos/security-skill-stack-mismatch.md` for why the previous Express/Mongo/JWT version was
replaced.

---

## OWASP Official Resources

### OWASP API Security Top 10 (2023) — primary framework for `server/`
- **Official page**: https://owasp.org/API-Security/
- **2023 edition**: https://owasp.org/API-Security/editions/2023/en/0x00-header/
- Chosen over the general Web Top 10 for the API surface because this repo has no
  server-rendered login flow — BOLA, resource consumption, and mass assignment are the live
  risks here, not session/auth categories that don't apply to a single-tenant MVP.

### OWASP Top 10:2025 (Web) — trimmed, for `client/` only
- **Official page**: https://owasp.org/Top10/2025/en/
- **Introduction**: https://owasp.org/Top10/2025/0x00_2025-Introduction/
- Only the Injection (XSS) and Security Misconfiguration categories are live risks in
  `client/` today — session/auth-heavy categories don't apply until a real login flow exists.

| # | Category | CWEs | % Apps Affected |
|---|----------|------|-----------------|
| A01 | Broken Access Control | 40 | 3.73% |
| A02 | Security Misconfiguration | 16 | 3.00% |
| A03 | Software Supply Chain Failures | 5 | New |
| A04 | Cryptographic Failures | 32 | 3.80% |
| A05 | Injection | 38 | — |
| A06 | Insecure Design | — | — |
| A07 | Authentication Failures | 36 | — |
| A08 | Software/Data Integrity Failures | — | — |
| A09 | Security Logging & Alerting Failures | 5 | — |
| A10 | Mishandling of Exceptional Conditions | 24 | New |

### ASVS 5.0 (Application Security Verification Standard)
- **Official project**: https://owasp.org/www-project-application-security-verification-standard/
- Three verification levels: L1 (all apps), L2 (sensitive data), L3 (critical systems)

### OWASP Top 10 for LLM Applications 2025
- Prompt Injection is #1 for the second consecutive edition — the basis for this skill's
  "no keyword denylist" rule (see `SKILL.md` § Agentic AI Security). Mitigations recommended:
  instruction segregation, constrained system prompts, output filtering, least-privilege
  tool access — not lexical filtering.

---

## Stack-Specific Security Documentation

### Fastify
- **`@fastify/helmet`**: https://github.com/fastify/fastify-helmet
- **`@fastify/cors`**: https://github.com/fastify/fastify-cors
- **`@fastify/rate-limit`**: https://github.com/fastify/fastify-rate-limit
- **`@fastify/multipart`**: https://github.com/fastify/fastify-multipart
- **Fastify Logging reference (Pino integration)**: https://fastify.dev/docs/latest/Reference/Logging/
- **Pino redaction docs**: https://github.com/pinojs/pino/blob/main/docs/redaction.md

### Drizzle ORM / Postgres
- **`sql` template docs**: https://orm.drizzle.team/docs/sql
- **Drizzle security advisory — `sql.raw()`/dynamic identifiers**:
  https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9
- **PostgreSQL security checklist**: https://www.postgresql.org/docs/current/security.html
- **fastify-type-provider-zod**: https://github.com/turkerdev/fastify-type-provider-zod

### Next.js / React
- **React security (`dangerouslySetInnerHTML`)**: https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html
- **DOMPurify**: https://github.com/cure53/DOMPurify
- **Next.js environment variables** (`NEXT_PUBLIC_*` is the public-in-bundle prefix, Next's
  equivalent of Vite's `VITE_*`): https://nextjs.org/docs/app/building-your-application/configuring/environment-variables

### Secrets management (general pattern, not stack-specific)
- **OWASP Secrets Management Cheat Sheet**: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- **WorkOS — secrets management best practices**: https://workos.com/guide/best-practices-for-secrets-management

---

## Community Security Skills — Sources

### Sentry Security Review Skill (Recommended Winner)
- **Repository**: https://github.com/getsentry/skills
- **Path**: `plugins/sentry-skills/skills/security-review/SKILL.md`
- **Key innovation**: Confidence-based reporting (HIGH/MEDIUM/LOW) to eliminate false
  positives — this is the origin of `SKILL.md`'s "Core Philosophy" section, kept as-is because
  it's framework-independent methodology, not stack-specific content.
- **Coverage**: 17 vulnerability reference guides, Python/JS/Go/Rust/Java, infrastructure

### agamm OWASP Security Skill
- **Repository**: https://github.com/agamm/claude-code-owasp
- **Key innovation**: OWASP Top 10:2025 + ASVS 5.0 + Agentic AI security in one skill

### Trail of Bits Security Skills
- **Repository**: https://github.com/trailofbits/skills
- **Key innovation**: Professional-grade audit tooling (24 skills)

### TimOnWeb: Security Skills Comparison
- **URL**: https://timonweb.com/ai/i-checked-5-security-skills-for-claude-code-only-one-is-worth-installing/
- **Finding**: Sentry's `security-review` was the only skill worth installing —
  confidence-based reporting, framework awareness, data flow tracing.

### Snyk: Top 9 Claude Security Skills
- **URL**: https://snyk.io/articles/top-claude-skills-cybersecurity-hacking-vulnerability-scanning/
- **Warning**: "Prompt injection found in 36% of skills tested" — always review SKILL.md before
  installing a third-party skill.

---

## CVE / Vulnerability Databases

- **NVD (National Vulnerability Database)**: https://nvd.nist.gov/
- **CVE.org**: https://www.cve.org/
- **GitHub Advisory Database**: https://github.com/advisories

## SAST / Dependency Tools

- **Semgrep**: Open source, rule-based pattern matching
- **CodeQL**: GitHub's query language for code analysis
- **`pnpm audit`**: Built into pnpm CLI — run per-package (`server/`, `client/`,
  `reviewer-core/`), each has its own lockfile in this repo

---

## OWASP Cheat Sheets (Quick References)

- **Authorization**: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- **Input Validation**: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- **XSS Prevention**: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- **SQL Injection Prevention**: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- **File Upload**: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- **Logging**: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- **Error Handling**: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- **REST Security**: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- **Secrets Management**: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

---

## Notable CVEs / Advisories Relevant to This Stack

| CVE / Advisory | Component | Impact |
|-----------------|-----------|--------|
| GHSA-gpj5-g38j-94v9 | Drizzle ORM | `sql.raw()` / dynamic identifiers unescaped — injection if fed unvalidated input |
| Prototype Pollution | Various npm packages | Object injection via `__proto__` |
| ReDoS | User-provided regex | Denial of service via catastrophic backtracking |

---

## Retired references (previous Express/Mongo/JWT version of this skill)

The prior version of this skill cited Express, Mongoose/MongoDB, `jsonwebtoken`, `multer`,
Vite, and bcrypt documentation. None of those libraries are used in this repo — removed rather
than kept "just in case," per the confidence-based philosophy this skill itself teaches: wrong
examples are worse than no examples, because an agent pattern-matches on them.

---

*Last updated: 2026-07-10. Review and update these references quarterly, or when the stack
changes.*
