import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  Onboarding,
  type OnboardingResponse,
  type OnboardingDegradedReason,
  type OnboardingSection,
} from '@devdigest/shared';
import type { RepoRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { AppConfig } from '../../platform/config.js';
import { NotFoundError } from '../../platform/errors.js';
import { renderPrompt } from '../../platform/prompts.js';
import { wrapUntrusted } from '../../platform/prompt.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { RepoRepository, type RepoRow } from '../repos/repository.js';
import type { IndexState } from '../repo-intel/types.js';
import * as t from '../../db/schema.js';
import { OnboardingRepository, type OnboardingRow } from './repository.js';
import {
  analyzeFirstTasks,
  isSourceFile,
  isTestFile,
  type FirstTaskCandidate,
  type SourceFileFact,
} from './analyzer.js';
import { normalizeSections } from './normalize.js';
import {
  EMPTY_SECTION,
  FIRST_TASK_SCAN_FILE_CAP,
  ONBOARDING_JOB_KIND,
  ONBOARDING_SECTION_KINDS,
  READING_PATH_FILE_COUNT,
  SKELETON_TITLES,
} from './constants.js';

/**
 * L05 — Onboarding Generator service (application layer).
 *
 * Orchestration only; the deterministic rules live in the pure `analyzer.ts`
 * (first-task candidates + badges) and `normalize.ts` (5-kind normalization,
 * link/diagram validation). Every external dependency (`repoIntel`, `llm`,
 * `git`, `jobs`, `runBus`, `db`) is reached through the container.
 *
 * Sync/async split (Gap-3):
 *   - degraded / missing / partial / degraded / failed index → handled
 *     SYNCHRONOUSLY on the POST: deterministic skeleton + reason code in the
 *     200 body, NO job, NO scanId, NO SSE, NO model call, NO index job (AC-11,
 *     AC-12, AC-16).
 *   - index present & full → ENQUEUE a generation job (202 { scanId }); the job
 *     makes the single `completeStructured` call, normalizes, and persists the
 *     artifact; progress streams over SSE under the scanId (AC-18).
 *
 * Persistence (Gap-4): only a SUCCESSFUL generation writes; a model failure
 * persists nothing, so a subsequent read returns the prior artifact.
 */

interface GeneratePayload {
  workspaceId: string;
  repoId: string;
  indexedSha: string;
  force: boolean;
}

export type GenerateOutcome =
  | { kind: 'degraded'; response: OnboardingResponse }
  | { kind: 'enqueued'; scanId: string };

interface GatheredFacts {
  readingPath: string[];
  allPaths: string[];
  criticalPaths: string[][];
  repoMap: string;
  sourceFiles: SourceFileFact[];
}

export class OnboardingService {
  private repo: OnboardingRepository;
  private repos: RepoRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);
    this.repos = new RepoRepository(container.db);
  }

  /** Register the generation job handler once at module load (conventions shape). */
  registerGenerationJobHandler(): void {
    this.container.jobs.register(ONBOARDING_JOB_KIND, async (payload, ctx) => {
      await this.runGeneration(payload as GeneratePayload, ctx.jobId);
    });
  }

  // ---- Reads ---------------------------------------------------------------

  /**
   * Read the persisted artifact for a repo (AC-9/13: ZERO model calls). Returns
   * `null` when nothing has ever been generated. A repo outside the caller's
   * workspace resolves as not-found (AC-22).
   */
  async getForRepo(workspaceId: string, repoId: string): Promise<OnboardingResponse | null> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const row = await this.repo.get(repoId);
    if (!row) return null;

    const state = await this.container.repoIntel.getIndexState(repoId);
    return this.rowToResponse(row, state, await this.isGenerating(workspaceId, repoId));
  }

  // ---- Generate (sync degraded vs async full) ------------------------------

  /**
   * Entry point for POST generate. Resolves the sync-vs-async branch: a
   * degraded/missing/partial/failed index returns a deterministic skeleton
   * synchronously (no job, no model); a full index enqueues a generation job.
   */
  async startGeneration(
    workspaceId: string,
    repoId: string,
    force: boolean,
  ): Promise<GenerateOutcome> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const state = await this.container.repoIntel.getIndexState(repoId);
    const reason = degradedReasonFor(state, this.container.config);
    if (reason) {
      // Synchronous fail-soft skeleton — no job, no model, no index job (AC-11/16).
      return { kind: 'degraded', response: this.buildSkeletonResponse(reason, state) };
    }

    // Full index: guard the double-POST-while-running case (N5) — reuse an
    // in-flight job for the same repo + current indexed SHA rather than
    // stampeding a second generation.
    const running = await this.runningJobId(workspaceId, repoId, state.lastIndexedSha);
    if (running) return { kind: 'enqueued', scanId: running };

    const { id } = await this.container.jobs.enqueue(workspaceId, ONBOARDING_JOB_KIND, {
      workspaceId,
      repoId,
      indexedSha: state.lastIndexedSha,
      force,
    } satisfies GeneratePayload);
    return { kind: 'enqueued', scanId: id };
  }

  // ---- Background generation handler ---------------------------------------

  async runGeneration(payload: GeneratePayload, scanId: string): Promise<void> {
    const { workspaceId, repoId } = payload;
    const bus = this.container.runBus;
    try {
      bus.publish(scanId, 'info', 'Gathering repo facts…');
      const repo = await this.repos.getById(workspaceId, repoId);
      if (!repo) throw new NotFoundError('Repo not found');

      const state = await this.container.repoIntel.getIndexState(repoId);
      const facts = await this.gatherFacts(repoId, repo);
      const firstTasks = analyzeFirstTasks({
        sourceFiles: facts.sourceFiles,
        allPaths: facts.allPaths,
      });
      bus.publish(
        scanId,
        'info',
        `Scanned ${facts.sourceFiles.length} source files; ${firstTasks.length} starter tasks`,
      );

      const { provider, model } = await resolveFeatureModel(
        this.container,
        workspaceId,
        'onboarding',
      );

      bus.publish(scanId, 'info', 'Writing the onboarding tour…');
      let result;
      try {
        const llm = await this.container.llm(provider);
        const systemPrompt = await renderPrompt('onboarding.system.md', {
          sections: ONBOARDING_SECTION_KINDS.join(', '),
          language: 'en',
        });
        const userContent = this.buildUntrustedFacts(facts, firstTasks);
        // AC-9: exactly one structured call, temperature 0, resolved model.
        result = await llm.completeStructured<Onboarding>({
          model,
          schema: Onboarding,
          schemaName: 'Onboarding',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0,
          maxTokens: 4000,
          sessionId: `onboarding:${scanId}`,
        });
      } catch (err) {
        // Model failure (Gap-4): persist NOTHING; the prior artifact survives.
        // Swallow (no rethrow) so there is no retry storm — exactly one call.
        bus.publish(scanId, 'error', `Generation failed: ${(err as Error).message}`);
        return;
      }

      const validPaths = await this.buildValidPaths(repo, facts.allPaths, result.data.sections);
      const sections = normalizeSections(result.data.sections, {
        validPaths,
        readingPathOrder: facts.readingPath,
      });

      // AC-13: persist the successful artifact keyed by repo + indexed SHA.
      await this.repo.upsert({
        repoId,
        sections,
        indexedSha: state.lastIndexedSha,
        filesIndexed: state.filesIndexed,
        model: result.model,
        costUsd: result.costUsd,
        generatedAt: new Date(),
      });

      // AC-10: record cost/tokens/model to the run trace (never surfaced in UI).
      bus.publish(scanId, 'result', 'Onboarding tour ready', {
        model: result.model,
        costUsd: result.costUsd,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      });
    } catch (err) {
      // Setup error (e.g. repo deleted mid-flight): report, persist nothing.
      bus.publish(scanId, 'error', (err as Error).message);
    } finally {
      bus.complete(scanId);
    }
  }

  // ---- Fact gathering (I/O; analyzer stays pure) ---------------------------

  private async gatherFacts(repoId: string, repo: RepoRow): Promise<GatheredFacts> {
    const ri = this.container.repoIntel;
    const [readingPath, allPaths, fanCounts, repoMap, criticalPaths] = await Promise.all([
      ri.getTopFilesByRank(repoId, READING_PATH_FILE_COUNT),
      ri.getIndexedFiles(repoId),
      ri.getFanCounts(repoId),
      ri.getRepoMap(repoId),
      ri.getCriticalPaths(repoId),
    ]);

    const fanByPath = new Map(fanCounts.map((f) => [f.path, f.fanIn + f.fanOut]));
    // Scan ONLY indexed, non-test source files (landmine: never a caller path).
    const sourcePaths = allPaths
      .filter((p) => isSourceFile(p) && !isTestFile(p))
      .slice(0, FIRST_TASK_SCAN_FILE_CAP);

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const sourceFiles: SourceFileFact[] = [];
    for (const path of sourcePaths) {
      // Bodies go through the sandboxed reader; a null (unsafe/missing) is skipped.
      const body = await this.container.git.readFileSafe(ref, path);
      if (body == null) continue;
      sourceFiles.push({ path, body, fanOut: fanByPath.get(path) ?? 0 });
    }

    return { readingPath, allPaths, criticalPaths, repoMap: repoMap.text, sourceFiles };
  }

  /**
   * Valid repo path set for link validation (AC-4, N2): the indexed set PLUS
   * any model-proposed link path that resolves to a real file in the git tree
   * (README.md / docker-compose.yml may be un-indexed but legitimate). Paths
   * are probed through the sandboxed reader — never a raw join.
   */
  private async buildValidPaths(
    repo: RepoRow,
    allPaths: string[],
    sections: OnboardingSection[],
  ): Promise<Set<string>> {
    const valid = new Set(allPaths);
    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const proposed = new Set<string>();
    for (const s of sections) {
      for (const l of s.links) {
        if (l.path && !valid.has(l.path)) proposed.add(l.path);
      }
    }
    for (const path of proposed) {
      const body = await this.container.git.readFileSafe(ref, path);
      if (body != null) valid.add(path);
    }
    return valid;
  }

  /** Assemble the repo-derived FACTS, fenced as untrusted (AC-21). */
  private buildUntrustedFacts(facts: GatheredFacts, firstTasks: FirstTaskCandidate[]): string {
    const parts: string[] = [];
    if (facts.repoMap.trim().length > 0) {
      parts.push(`## Repo skeleton\n${wrapUntrusted('repo-map', facts.repoMap)}`);
    }
    if (facts.readingPath.length > 0) {
      parts.push(
        `## Reading path (files by descending importance)\n${wrapUntrusted(
          'reading-path',
          facts.readingPath.map((p, i) => `${i + 1}. ${p}`).join('\n'),
        )}`,
      );
    }
    if (facts.criticalPaths.length > 0) {
      parts.push(
        `## Critical dependency chains\n${wrapUntrusted(
          'critical-paths',
          facts.criticalPaths.map((chain) => chain.join(' → ')).join('\n'),
        )}`,
      );
    }
    if (firstTasks.length > 0) {
      parts.push(
        `## Candidate first tasks (grounded facts — file, reason, complexity)\n${wrapUntrusted(
          'first-tasks',
          firstTasks
            .map((c) => `- ${c.path} — ${c.reason} — complexity ${c.badge}`)
            .join('\n'),
        )}`,
      );
    }
    parts.push(
      'Write the five sections grounded ONLY in the FACTS above. Use only file paths present in the input.',
    );
    return parts.join('\n\n');
  }

  // ---- Response builders ---------------------------------------------------

  private rowToResponse(
    row: OnboardingRow,
    state: IndexState,
    generating: boolean,
  ): OnboardingResponse {
    const indexedSha = row.indexedSha ?? '';
    const status: 'fresh' | 'stale' =
      indexedSha.length > 0 && indexedSha === state.lastIndexedSha ? 'fresh' : 'stale';
    return {
      sections: (row.json as OnboardingSection[]) ?? [],
      status,
      degraded: row.degraded ?? false,
      degradedReason: (row.degradedReason as OnboardingDegradedReason | null) ?? undefined,
      indexedSha,
      filesIndexed: row.filesIndexed ?? 0,
      generatedAt: row.generatedAt.toISOString(),
      generating,
    };
  }

  /** Deterministic degraded skeleton (AC-11/12): 5 sections, honest badge, no model. */
  private buildSkeletonResponse(
    reason: OnboardingDegradedReason,
    state: IndexState,
  ): OnboardingResponse {
    const sections: OnboardingSection[] = ONBOARDING_SECTION_KINDS.map((kind) => ({
      kind,
      title: SKELETON_TITLES[kind],
      body:
        'This section will be generated once the repository index is available. ' +
        'The index is currently unavailable, so no tour has been written yet.',
      ...EMPTY_SECTION,
    }));
    return {
      sections,
      status: 'stale',
      degraded: true,
      degradedReason: reason,
      indexedSha: state.lastIndexedSha,
      filesIndexed: state.filesIndexed,
      generatedAt: new Date().toISOString(),
      generating: false,
    };
  }

  // ---- Job-state helpers ---------------------------------------------------

  private async isGenerating(workspaceId: string, repoId: string): Promise<boolean> {
    return (await this.runningJobId(workspaceId, repoId)) !== null;
  }

  /** The id of an in-flight generation job for this repo (+ optional SHA), if any. */
  private async runningJobId(
    workspaceId: string,
    repoId: string,
    indexedSha?: string,
  ): Promise<string | null> {
    const rows = await this.container.db
      .select({ id: t.jobs.id, payload: t.jobs.payload })
      .from(t.jobs)
      .where(
        and(
          eq(t.jobs.workspaceId, workspaceId),
          eq(t.jobs.kind, ONBOARDING_JOB_KIND),
          inArray(t.jobs.status, ['queued', 'running']),
          sql`${t.jobs.payload}->>'repoId' = ${repoId}`,
        ),
      );
    for (const r of rows) {
      if (indexedSha === undefined) return r.id;
      const p = r.payload as { indexedSha?: string } | null;
      if (p?.indexedSha === indexedSha) return r.id;
    }
    return null;
  }
}

/**
 * Map the repo-intel index state to a closed onboarding reason code, or `null`
 * when the index is present & full (proceed to a real generation). Derived from
 * the repo-intel `DegradedReason` vocabulary (plan §3), not invented.
 */
export function degradedReasonFor(
  state: IndexState,
  config: AppConfig,
): OnboardingDegradedReason | null {
  if (!config.repoIntelEnabled) return 'flag_off';
  switch (state.status) {
    case 'partial':
      return 'index_partial';
    case 'failed':
      return 'index_failed';
    case 'degraded':
      return state.degradedReason ?? 'no_data';
    case 'full':
      return state.lastIndexedSha ? null : 'no_data';
    default:
      return 'no_data';
  }
}
