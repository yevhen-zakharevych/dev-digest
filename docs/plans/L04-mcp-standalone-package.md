# План: винесення MCP у пакет `@devdigest/mcp-server`

## Context

Зараз MCP-сервер живе всередині `server/` (`server/src/mcp/**` + `server/src/mcp.ts`) як **третій entrypoint**: він піднімає власний `Container` + Postgres-з'єднання і викликає internal application-сервіси напряму (`AgentsService`, `ReviewService`, `ConventionsService`). Це найглибший можливий рівень зчеплення з `server/` — «окремим» пакетом його зробити не можна без розриву цієї залежності.

Мета — винести MCP у самодостатній top-level пакет `mcp-server/` (`@devdigest/mcp-server`, поряд із `server/`, `client/`, `reviewer-core/`, `e2e/`) за зразком еталонної реалізації `github.com/burnjohn/dev-digest@lesson-4-lab/mcp-finish`. Обраний підхід (погоджено з користувачем) — **тонкий HTTP-клієнт**: кожен із 5 тулів звертається до вже запущеного Fastify API на `http://localhost:3001`, а не до БД. Пакет тягне лише `@modelcontextprotocol/sdk` + `zod`; `@devdigest/shared` споживається через tsconfig `paths` напряму з `../server/src/vendor/shared` (без третьої копії вендореного контракту, як `reviewer-core` вже читає shared).

## Архітектура

**Мапа «тул → REST-ендпоінт»:**

| Тул | Новий REST-виклик | Резолв |
|---|---|---|
| `list_agents` | `GET /agents` → `Agent[]` | — |
| `run_agent_on_pr` | `POST /pulls/:id/review {agentId}` → poll `GET /pulls/:id/runs` → done: `GET /runs/:id/review` (**E3**) | E1+E2 |
| `get_findings` | run_id: `GET /runs/:id/review` (**E3**); repo+pr: `GET /pulls/:id/reviews` | E1+E2 |
| `get_conventions` | `GET /repos/:repoId/conventions?status=accepted` | E1 |
| `get_blast_radius` | `GET /pulls/:id/blast` → `BlastRadius` (вже змаплено server-side) | E1+E2 |

**Три нові дешеві server-роути-містки** (DB-read, без GitHub-синку, без LLM; shared-контракти НЕ змінюються — усі віддають тривіальний `{id}` або наявний `ReviewDto`):
- **E1** `GET /repos/resolve?slug=owner/name` (модуль `repos`) → `RepoRepository.findByFullName` → `{id}` / 404.
- **E2** `GET /repos/:id/pulls/resolve?number=N` (модуль `pulls`) → прямий read `t.pullRequests` по `workspaceId+repoId+number` → `{id}` / 404.
- **E3** `GET /runs/:id/review` (модуль `reviews`, поряд із `/runs/:id/trace`) → наявний `reviewRepo.reviewByRunId` → `reviewToDto` → `ReviewDto` / 404. Обслуговує done-гілку `run_agent_on_pr` і run_id-гілку `get_findings`.

**Структура пакета `mcp-server/`:**
```
mcp-server/
├── package.json      # deps: sdk+zod; dev: tsx/typescript/@types/node/vitest; scripts start/typecheck/test
├── tsconfig.json     # копія reviewer-core/tsconfig.json; paths @devdigest/shared → ../server/src/vendor/shared/index.ts
├── .env.example      # DEVDIGEST_API_URL=http://localhost:3001, MAX_WAIT_MS=60000
├── .gitignore
└── src/
    ├── index.ts      # stdio entrypoint (порт server/src/mcp.ts, БЕЗ createDb/Container)
    ├── config.ts     # DEVDIGEST_API_URL, MAX_WAIT_MS, POLL_INTERVAL_MS
    ├── log.ts        # ЛИШЕ console.error (stdout належить JSON-RPC)
    ├── http/client.ts# fetch-обгортка + ApiError{status,url,message}
    ├── schemas.ts    # transport-local input/output схеми (перенос as-is)
    ├── mappers.ts    # toConcise/toDetailed/toFinding + paginateFindings (спрощені: вхід завжди snake_case DTO)
    ├── resolve.ts    # REPO_SLUG_RE локально + E1/E2 через http/client → union {ok:false,reason}
    ├── server.ts     # buildMcpServer(client) — transport-agnostic
    └── tools/{list-agents,run-agent-on-pr,get-findings,get-conventions,get-blast-radius}.ts
```

**Ключові рішення при переносі:**
- Мапери спрощуються: гілка `FindingRow`/`isDbFindingRow`/`findingRowToDto`/`normalize` видаляється (HTTP завжди віддає готовий `Finding`); алгоритм `paginateFindings` (сорт CRITICAL→WARNING→SUGGESTION, char-budget 25000, ≥1/сторінка) зберігається дослівно. `blastResultToContract`/`emptyBlastRadius` лишаються в `server/src/modules/blast/contract.ts`.
- `resolve.ts` зберігає `REPO_SLUG_RE` для локальної bad_slug-валідації; той самий discriminated union `{ok:false, reason:'bad_slug'|'not_found'}`.
- `run_agent_on_pr` відтворює bounded-poll на боці клієнта (`GET /pulls/:id/runs` кожні `POLL_INTERVAL_MS` до `MAX_WAIT_MS`); done→E3 concise, failed/cancelled→errorResult, timeout→`RunResult.parse({status:'running'})`.
- Імена тулів БЕЗ префікса (`list_agents`, …), ті самі `inputSchema`/`outputSchema`/annotations та повідомлення «error leads onward».
- Інваріант stdout: жодного `console.log` у шляху пакета.

**Прибирання зі server:** видалити `server/src/mcp/**`, `server/src/mcp.ts`, `server/test/{mcp-schemas,mcp-mappers,mcp}.{test,it.test}.ts`; зняти скрипт `"mcp"` та dep `@modelcontextprotocol/sdk` зі `server/package.json` (grep підтвердив: поза `mcp` sdk не використовується).

**`.mcp.json`:** команду запуску перевести з `pnpm --dir server mcp` на новий пакет (`pnpm --dir mcp-server start`), додати передумову «спершу підняти API через `./scripts/dev.sh`».

## Декомпозиція (паралельні задачі, disjoint file-ownership)

| Task | Опис | Files owned | Batch |
|---|---|---|---|
| **A** | Scaffold пакета (package.json, tsconfig, .env.example, .gitignore) | `mcp-server/{package.json,tsconfig.json,.env.example,.gitignore}` | — |
| **B** | config + log + http/client | `mcp-server/src/{config,log}.ts`, `mcp-server/src/http/client.ts` | mcp-core (після A) |
| **C** | Схеми (перенос as-is) | `mcp-server/src/schemas.ts` | mcp-core |
| **D** | Мапери (перенос+спрощення) | `mcp-server/src/mappers.ts` | mcp-core |
| **E** | resolve + 5 tools + server + index | `mcp-server/src/{resolve,server,index}.ts`, `mcp-server/src/tools/*.ts` | після A,B,C,D |
| **F** | Тести пакета (schemas, mappers, tools з mock http) | `mcp-server/test/*.test.ts` | після A,C,D,E |
| **I** | E1 resolve repo | `server/src/modules/repos/{routes,service}.ts` | server-endpoints |
| **J** | E2 resolve pr# | `server/src/modules/pulls/routes.ts` | server-endpoints |
| **K** | E3 review-by-run | `server/src/modules/reviews/routes.ts` | server-endpoints |
| **L** | Прибрати MCP зі server (+package.json) | `server/src/mcp*`, `server/test/mcp*`, `server/package.json` | окремо |
| **O** | IT для E1/E2/E3 | `server/test/mcp-http-endpoints.it.test.ts` | після I,J,K |
| **N** | Оновити `.mcp.json` | `.mcp.json` | після A |

Skills: server-задачі (I/J/K/O) — `onion-architecture` + `fastify-best-practices` + `zod`; клієнтські — `typescript-expert`, `zod`, `security` (для http/client + resolve). Кілька implementer-агентів працюватимуть на спільному дереві — file-ownership disjoint (root `INSIGHTS.md:27`). L свідомо окремо від I/J/K, щоб не змішувати додавання й видалення. Перед виконанням план збережу також у `docs/plans/` (конвенція репо).

## Ризики

- **Резолв `paths` вгору по дереву на `../server/src/vendor/shared`** — дзеркалимо перевірений `reviewer-core/tsconfig.json` (той самий alias, на рівень глибше).
- **Route-collision `/repos/resolve` vs `/repos/:id/pulls`** — статичний сегмент виграє; покрито boot-smoke + IT.
- **Втрата linkage run_id→review** — E3 обов'язкова задача, покрита O; done-гілка `run_agent_on_pr` теж через E3.
- **Забруднення stdout логом ламає JSON-RPC** — `log.ts` лише stderr, винесено в acceptance.
- **Grounding gate** — ризику немає: ревʼю виконується в server (`POST /pulls/:id/review`), `groundFindings()` не обходиться.

## Verification

- `cd mcp-server && pnpm typecheck && pnpm test` — зелені (hermetic vitest: schemas, mappers, tools з mock `http/client`).
- `cd server && pnpm typecheck` — зелений після видалення MCP і зняття sdk.
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — зелений (без старих mcp-unit).
- `cd server && pnpm exec vitest run .it.test` — зелений, включно з новим `mcp-http-endpoints.it.test.ts` (E1/E2/E3 + 404).
- `rg modelcontextprotocol server/src` — порожньо; `server/package.json` без `mcp`-скрипта і без sdk.
- **Ручний E2E smoke:** `./scripts/dev.sh` (підняти API) → `pnpm --dir mcp-server start` → перевірити через MCP Inspector (`pnpm --dir mcp-server inspect`) або з Claude Code, що всі 5 тулів працюють і stdout несе лише JSON-RPC (діагностика — у stderr).
- `client` не змінюється; vendored shared (server↔client) не дрейфнув.
