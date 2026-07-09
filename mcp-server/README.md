# @devdigest/mcp-server

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes DevDigest's review engine as 5 tools over **stdio**. It is a thin
**HTTP client** to the running DevDigest Fastify API (`localhost:3001`) — it
holds no database connection and no `Container`; every tool is a `fetch` call.

This is the L04 "extract the MCP server into its own package" step: the tools
used to live inside `server/src/mcp/**` and reach the DB directly; they now live
here and reach the product over REST.

## Prerequisites

The DevDigest API must be running — the tools call it. From the repo root:

```bash
./scripts/dev.sh          # Postgres + API (:3001) + web (:3000), seeded
```

## Install & run

```bash
cd mcp-server
pnpm install
pnpm start                # tsx src/index.ts — speaks MCP over stdio
```

Register it with an MCP client via the repo-root `.mcp.json` (already wired for
Claude Code):

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "pnpm",
      "args": ["--dir", "<abs-path>/mcp-server", "start"],
      "env": { "DEVDIGEST_API_URL": "http://localhost:3001" }
    }
  }
}
```

## Tools

| Tool | What it does | REST endpoint(s) |
|---|---|---|
| `list_agents` | List configured review agents | `GET /agents` |
| `run_agent_on_pr` | Run one agent on a PR, wait for the verdict (the only mutating tool) | `POST /pulls/:id/review`, poll `GET /pulls/:id/runs`, `GET /runs/:id/review` |
| `get_findings` | Fetch a completed review's findings (by `run_id` or `repo`+`pr`), paginated | `GET /runs/:id/review`, `GET /pulls/:id/reviews` |
| `get_conventions` | A repo's accepted house conventions | `GET /repos/:id/conventions?status=accepted` |
| `get_blast_radius` | A PR's impact map (changed symbols → callers → endpoints/crons) | `GET /pulls/:id/blast` |

Tools take human-friendly args (`repo: "owner/name"`, `pr: 42`); the package
resolves them to internal ids via `GET /repos/resolve` and
`GET /repos/:id/pulls/resolve`.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Base URL of the running API |
| `MAX_WAIT_MS` | `45000` | How long `run_agent_on_pr` blocks before returning `{ run_id, status: "running" }`. Clamped to 55 s — it must stay under the MCP client's 60 s request timeout, or the client aborts the call with `-32001 Request timed out` mid-review. Slower reviews return the `running` handoff; finish them with `get_findings`. |

## Develop

```bash
pnpm typecheck            # tsc --noEmit
pnpm test                 # vitest (hermetic: schemas, mappers, tools with a mocked HTTP client)
pnpm inspect              # @modelcontextprotocol/inspector against the stdio server
```

`@devdigest/shared` contracts are consumed as TS source via a tsconfig path
alias into `../server/src/vendor/shared` — no third vendored copy. **stdout is
reserved for JSON-RPC**: all diagnostics go to stderr (see `src/log.ts`), never
`console.log`.
