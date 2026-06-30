import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  ConventionCandidatesResponse,
  type ConventionCandidate,
  type ConventionCategory,
  type ConventionScanSummary,
  type ConventionStatus,
  type ConventionSkillPreview,
  type Skill,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, BadRequestError } from '../../platform/errors.js';
import { loadPromptTemplate } from '../../platform/prompts.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { SkillsService } from '../skills/service.js';
import * as t from '../../db/schema.js';
import { RepoRepository } from '../repos/repository.js';
import { ConventionsRepository, type ConventionRow } from './repository.js';
import {
  CONVENTION_CONFIG_GLOBS,
  CONVENTION_EXTRACT_JOB_KIND,
  CONVENTION_FILE_LINE_BUDGET,
  CONVENTION_SAMPLE_COUNT,
  CONVENTION_SNIPPET_LINE_SLACK,
  CONVENTION_SNIPPET_MAX_CHARS,
} from './constants.js';

/**
 * L0X — Conventions Extractor service.
 *
 * Flow:
 *   1. UI: POST /repos/:repoId/conventions/extract → `startExtraction`
 *   2. JobRunner picks up `convention_extract` → `runExtraction`
 *   3. handler streams progress over `RunBus` (consumed by /runs/:id/events SSE)
 *   4. UI accepts/rejects/edits candidates, then merges accepted into a Skill
 *
 * Verification is custom (not `groundFindings`, which is diff-shaped): each
 * candidate's evidence file MUST exist inside the repo clone, the cited line
 * range MUST be in bounds, and the persisted snippet is the literal slice
 * from disk (LLM-supplied text never leaks unverified into the DB).
 */

interface ExtractPayload {
  workspaceId: string;
  repoId: string;
}

export interface StartExtractionResult {
  scanId: string;
  jobId: string;
}

export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    repo_id: row.repoId ?? '',
    scan_id: row.scanId ?? null,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    status: row.status as ConventionStatus,
    created_at: row.createdAt.toISOString(),
  };
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private repos: RepoRepository;
  private skills: SkillsService;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.repos = new RepoRepository(container.db);
    this.skills = new SkillsService(container);
  }

  /**
   * Register the `convention_extract` job handler. Called once at module load,
   * mirrors RepoService.registerCloneJobHandler. The JobRunner stores the
   * handler closure, so the local `service` is captured for the lifetime of
   * the process.
   */
  registerExtractionJobHandler(): void {
    this.container.jobs.register(CONVENTION_EXTRACT_JOB_KIND, async (payload, ctx) => {
      await this.runExtraction(payload as ExtractPayload, ctx.jobId);
    });
  }

  // ---- Public API used by routes -------------------------------------------

  async startExtraction(
    workspaceId: string,
    repoId: string,
  ): Promise<StartExtractionResult> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    if (!repo.clonePath) {
      throw new BadRequestError(
        'Repo is not cloned yet — wait for the initial clone to finish before scanning conventions',
      );
    }
    const { id: jobId } = await this.container.jobs.enqueue(
      workspaceId,
      CONVENTION_EXTRACT_JOB_KIND,
      { workspaceId, repoId } satisfies ExtractPayload,
    );
    return { scanId: jobId, jobId };
  }

  async listForRepo(
    workspaceId: string,
    repoId: string,
    statuses: ConventionStatus[],
  ): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId, statuses);
    return rows.map(toConventionDto);
  }

  async updateCandidate(
    workspaceId: string,
    id: string,
    patch: { status?: ConventionStatus; rule?: string },
  ): Promise<ConventionCandidate | undefined> {
    let row: ConventionRow | undefined;
    if (patch.rule !== undefined) {
      row = await this.repo.updateRule(workspaceId, id, patch.rule);
      if (!row) return undefined;
    }
    if (patch.status !== undefined) {
      row = await this.repo.setStatus(workspaceId, id, patch.status);
      if (!row) return undefined;
    }
    if (!row) {
      // No-op patch: still return current row so the caller can refresh UI.
      const existing = await this.repo.getById(workspaceId, id);
      if (!existing) return undefined;
      row = existing;
    }
    return toConventionDto(row);
  }

  async latestScan(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionScanSummary> {
    const [row] = await this.container.db
      .select({
        id: t.jobs.id,
        status: t.jobs.status,
        startedAt: t.jobs.startedAt,
        finishedAt: t.jobs.finishedAt,
        error: t.jobs.error,
      })
      .from(t.jobs)
      .where(
        and(
          eq(t.jobs.workspaceId, workspaceId),
          eq(t.jobs.kind, CONVENTION_EXTRACT_JOB_KIND),
          // payload->>'repoId' = $repoId — encoded as drizzle SQL fragment.
          sql`${t.jobs.payload}->>'repoId' = ${repoId}`,
        ),
      )
      .orderBy(desc(t.jobs.scheduledAt))
      .limit(1);

    if (!row) {
      return {
        scan_id: null,
        status: null,
        started_at: null,
        finished_at: null,
        error: null,
      };
    }

    return {
      scan_id: row.id,
      status: row.status as ConventionScanSummary['status'],
      started_at: row.startedAt?.toISOString() ?? null,
      finished_at: row.finishedAt?.toISOString() ?? null,
      error: row.error ?? null,
    };
  }

  /**
   * Server-computed seed for the "Create skill from conventions" modal. Pulls
   * the accepted candidates by id and renders the markdown body — the same
   * function is reused on save, so the persisted body matches what the user
   * saw in the preview (modulo any inline edits they made before clicking
   * Save).
   */
  async skillPreview(
    workspaceId: string,
    repoId: string,
    candidateIds: string[],
  ): Promise<ConventionSkillPreview> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const accepted = await this.loadAcceptedCandidates(workspaceId, repoId, candidateIds);
    return {
      name: `${repo.name}-conventions`,
      description: `${accepted.length} house convention${accepted.length === 1 ? '' : 's'} extracted from ${repo.fullName}`,
      body: this.assembleSkillBody(repo.fullName, accepted),
    };
  }

  async createSkillFromAccepted(
    workspaceId: string,
    repoId: string,
    input: {
      candidateIds: string[];
      name: string;
      description: string;
      body: string;
      enabled?: boolean;
    },
  ): Promise<Skill> {
    const accepted = await this.loadAcceptedCandidates(
      workspaceId,
      repoId,
      input.candidateIds,
    );
    const evidenceFiles = Array.from(
      new Set(accepted.map((c) => c.evidencePath).filter((p): p is string => !!p)),
    );
    return this.skills.create(
      workspaceId,
      {
        name: input.name,
        description: input.description,
        type: 'convention',
        body: input.body,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        evidenceFiles,
      },
      'extracted',
    );
  }

  // ---- Background extraction handler ---------------------------------------

  async runExtraction(payload: ExtractPayload, scanId: string): Promise<void> {
    const { workspaceId, repoId } = payload;
    const bus = this.container.runBus;
    try {
      bus.publish(scanId, 'info', 'Resolving repo clone…');
      const repo = await this.repos.getById(workspaceId, repoId);
      if (!repo) throw new NotFoundError('Repo not found');
      if (!repo.clonePath) {
        throw new BadRequestError('Repo is not cloned yet');
      }
      const cloneRoot = await realpath(repo.clonePath);

      bus.publish(scanId, 'info', 'Selecting sample files…');
      const sampledFiles = await this.container.repoIntel.getConventionSamples(
        repoId,
        CONVENTION_SAMPLE_COUNT,
      );
      const configFiles = await this.findConfigFiles(cloneRoot);
      const samplePaths = uniq([...configFiles, ...sampledFiles]);
      bus.publish(scanId, 'info', `Sampled ${samplePaths.length} files`);

      const bundle = await this.readSampleBundle(cloneRoot, samplePaths);
      if (bundle.length === 0) {
        bus.publish(scanId, 'result', 'No readable samples — nothing to extract', {
          kept: 0,
          dropped: 0,
        });
        return;
      }

      bus.publish(scanId, 'info', 'Asking model for candidates…');
      const candidates = await this.callModel(workspaceId, bundle, scanId);
      bus.publish(scanId, 'info', `Model returned ${candidates.length} candidates`);

      const verified = await this.verifyCandidates(cloneRoot, candidates);
      const dropped = candidates.length - verified.length;
      if (dropped > 0) {
        bus.publish(
          scanId,
          'info',
          `Dropped ${dropped} unverified candidate${dropped === 1 ? '' : 's'} (missing file or out-of-range lines)`,
        );
      }

      if (verified.length === 0) {
        bus.publish(scanId, 'result', 'done', { kept: 0, dropped });
        return;
      }

      await this.repo.insertMany(
        verified.map((v) => ({
          workspaceId,
          repoId,
          scanId,
          rule: v.rule,
          evidencePath: v.evidence_path,
          evidenceSnippet: v.snippet,
          confidence: v.confidence,
        })),
      );
      bus.publish(scanId, 'result', 'done', { kept: verified.length, dropped });
    } catch (err) {
      bus.publish(scanId, 'error', (err as Error).message);
      throw err;
    } finally {
      bus.complete(scanId);
    }
  }

  // ---- Internals -----------------------------------------------------------

  private async loadAcceptedCandidates(
    workspaceId: string,
    repoId: string,
    candidateIds: string[],
  ): Promise<ConventionRow[]> {
    const rows = await this.repo.getByIds(workspaceId, repoId, candidateIds);
    if (rows.length !== candidateIds.length) {
      throw new BadRequestError('One or more candidates not found in this repo');
    }
    const nonAccepted = rows.filter((r) => r.status !== 'accepted');
    if (nonAccepted.length > 0) {
      throw new BadRequestError(
        `Cannot create skill: ${nonAccepted.length} candidate(s) are not accepted`,
      );
    }
    return rows;
  }

  /** Markdown layout shared by `skillPreview` (seed) and the persisted body. */
  private assembleSkillBody(repoFullName: string, rows: ConventionRow[]): string {
    const intro = `# House Conventions — ${repoFullName}\n\nExtracted from the repository. Apply when reviewing changes to this codebase.`;
    const sections = rows.map((r) => {
      const path = r.evidencePath ?? '(unknown)';
      const snippet = r.evidenceSnippet ?? '';
      return [
        `## ${r.rule}`,
        '',
        `_Evidence: \`${path}\`_`,
        '',
        '```',
        snippet,
        '```',
      ].join('\n');
    });
    return [intro, ...sections].join('\n\n---\n\n');
  }

  private async findConfigFiles(cloneRoot: string): Promise<string[]> {
    const out: string[] = [];
    const checked = new Set<string>();
    for (const name of CONVENTION_CONFIG_GLOBS) {
      if (checked.has(name)) continue;
      checked.add(name);
      const abs = join(cloneRoot, name);
      try {
        await readFile(abs, 'utf8');
        out.push(name);
      } catch {
        // missing — skip silently
      }
    }
    return out;
  }

  private async readSampleBundle(
    cloneRoot: string,
    paths: string[],
  ): Promise<string> {
    const blocks: string[] = [];
    for (const rel of paths) {
      const abs = await safeResolve(cloneRoot, rel);
      if (!abs) continue;
      try {
        const text = await readFile(abs, 'utf8');
        const lines = text.split(/\r?\n/).slice(0, CONVENTION_FILE_LINE_BUDGET);
        const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n');
        blocks.push(`--- FILE: ${rel} ---\n${numbered}`);
      } catch {
        // unreadable — skip
      }
    }
    return blocks.join('\n\n');
  }

  private async callModel(
    workspaceId: string,
    bundle: string,
    scanId: string,
  ): Promise<ConventionCandidatesResponse['candidates']> {
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'conventions',
    );
    const llm = await this.container.llm(provider);
    const systemPrompt = await loadPromptTemplate('conventions-extract.md');
    const result = await llm.completeStructured<ConventionCandidatesResponse>({
      model,
      schema: ConventionCandidatesResponse,
      schemaName: 'ConventionCandidatesResponse',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: bundle },
      ],
      temperature: 0.1,
      maxTokens: 4000,
      sessionId: `conventions:${scanId}`,
    });
    return result.data.candidates;
  }

  private async verifyCandidates(
    cloneRoot: string,
    candidates: ConventionCandidatesResponse['candidates'],
  ): Promise<
    Array<{
      rule: string;
      evidence_path: string;
      snippet: string;
      confidence: number;
      category: ConventionCategory;
    }>
  > {
    const out: Array<{
      rule: string;
      evidence_path: string;
      snippet: string;
      confidence: number;
      category: ConventionCategory;
    }> = [];
    for (const c of candidates) {
      const abs = await safeResolve(cloneRoot, c.evidence_path);
      if (!abs) continue;
      let text: string;
      try {
        text = await readFile(abs, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      const start = Math.max(1, Math.min(c.evidence_line_start, c.evidence_line_end));
      const end = Math.min(lines.length, Math.max(c.evidence_line_start, c.evidence_line_end));
      if (start > lines.length) continue;
      const sliceStart = Math.max(1, start - CONVENTION_SNIPPET_LINE_SLACK);
      const sliceEnd = Math.min(lines.length, end + CONVENTION_SNIPPET_LINE_SLACK);
      const snippetLines = lines.slice(sliceStart - 1, sliceEnd);
      const snippet = snippetLines
        .join('\n')
        .replace(/^\s*\n+|\n+\s*$/g, '')
        .slice(0, CONVENTION_SNIPPET_MAX_CHARS);
      if (snippet.length === 0) continue;
      out.push({
        rule: c.rule.trim(),
        evidence_path: c.evidence_path,
        snippet,
        confidence: c.confidence,
        category: c.category,
      });
    }
    return out;
  }
}

// ---- Helpers ---------------------------------------------------------------

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/**
 * Resolve a repo-relative path against the clone root, refusing anything that
 * escapes (path traversal). Returns the absolute path or null when the input
 * is unsafe / non-existent.
 */
async function safeResolve(cloneRoot: string, rel: string): Promise<string | null> {
  if (!rel || isAbsolute(rel) || rel.includes('\0')) return null;
  const target = resolve(cloneRoot, rel);
  const rootWithSep = cloneRoot.endsWith(sep) ? cloneRoot : cloneRoot + sep;
  if (target !== cloneRoot && !target.startsWith(rootWithSep)) return null;
  try {
    const real = await realpath(target);
    if (real !== cloneRoot && !real.startsWith(rootWithSep)) return null;
    return real;
  } catch {
    return null;
  }
}
