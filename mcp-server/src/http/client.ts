/**
 * Thin typed fetch client for the DevDigest Fastify API (localhost:3001).
 *
 * This is the seam that replaces the old in-`server/` MCP transport's direct
 * `Container`/DB access: every tool now reaches the product through HTTP here.
 * Errors normalize to `ApiError{status,url,message}` so tool handlers can
 * branch on `status === 404` for the "error leads onward" not-found paths and
 * let anything else propagate.
 */
import type { McpConfig } from '../config.js';
import type { Agent, ConventionCandidate, BlastRadius, Finding } from '@devdigest/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
  }
}

/**
 * One row of a PR's run history. Structural subset of the server's `RunSummary`
 * contract — we only read the fields the poll loop needs, so we don't depend on
 * the full shared schema being exported.
 */
export interface RunRow {
  run_id: string;
  status: string | null;
  error: string | null;
}

/** Response of `POST /pulls/:id/review`. `runs[0].run_id` is the run we poll. */
export interface RunReviewResponse {
  pr_id: string;
  runs: RunRow[];
}

/**
 * A persisted review as returned by `GET /runs/:id/review` and
 * `GET /pulls/:id/reviews`. Structural subset of the server's `ReviewDto`
 * (findings are the snake_case `Finding` superset). We read only verdict +
 * findings.
 */
export interface ReviewResponse {
  run_id: string | null;
  verdict: string | null;
  findings: Finding[];
}

export class HttpClient {
  constructor(private readonly config: McpConfig) {}

  // ---- typed endpoint wrappers (the tool → REST map lives here) -----------

  listAgents(): Promise<Agent[]> {
    return this.get<Agent[]>('/agents');
  }

  resolveRepo(slug: string): Promise<{ id: string }> {
    return this.get<{ id: string }>(`/repos/resolve?slug=${encodeURIComponent(slug)}`);
  }

  resolvePr(repoId: string, number: number): Promise<{ id: string }> {
    return this.get<{ id: string }>(
      `/repos/${encodeURIComponent(repoId)}/pulls/resolve?number=${number}`,
    );
  }

  runReview(prId: string, agentId: string): Promise<RunReviewResponse> {
    return this.post<RunReviewResponse>(`/pulls/${encodeURIComponent(prId)}/review`, { agentId });
  }

  listRuns(prId: string): Promise<RunRow[]> {
    return this.get<RunRow[]>(`/pulls/${encodeURIComponent(prId)}/runs`);
  }

  reviewByRun(runId: string): Promise<ReviewResponse> {
    return this.get<ReviewResponse>(`/runs/${encodeURIComponent(runId)}/review`);
  }

  reviewsForPull(prId: string): Promise<ReviewResponse[]> {
    return this.get<ReviewResponse[]>(`/pulls/${encodeURIComponent(prId)}/reviews`);
  }

  conventions(repoId: string): Promise<ConventionCandidate[]> {
    return this.get<ConventionCandidate[]>(
      `/repos/${encodeURIComponent(repoId)}/conventions?status=accepted`,
    );
  }

  blast(prId: string): Promise<BlastRadius> {
    return this.get<BlastRadius>(`/pulls/${encodeURIComponent(prId)}/blast`);
  }

  // ---- transport ----------------------------------------------------------

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.config.apiUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        // Only declare a JSON body when one is actually sent — a body-less POST
        // otherwise trips Fastify's "Body cannot be empty" content-type check.
        headers: body != null ? { 'content-type': 'application/json' } : {},
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiError(
        `cannot reach the DevDigest API at ${this.config.apiUrl} — is it running? (start it with ./scripts/dev.sh)`,
        0,
        url,
      );
    }

    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const errBody = (await res.json()) as { error?: { message?: string } };
        if (errBody?.error?.message) message = errBody.error.message;
      } catch {
        /* non-JSON error body — keep the status-line message */
      }
      throw new ApiError(message, res.status, url);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

/** Injected into every tool handler in place of the old `Container`. */
export interface ToolDeps {
  client: HttpClient;
  config: McpConfig;
}
