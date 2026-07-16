import type {
  BriefCost,
  BriefDegradedReason,
  BriefResponse,
  Intent,
  RepoRef,
  RiskBrief,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { RunLogger, type PinoLike } from '../../platform/run-logger.js';
import { renderPrompt } from '../../platform/prompts.js';
import type { PullRow } from '../../db/rows.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { IntentService } from '../reviews/intent.service.js';
import { SmartDiffService } from '../reviews/smart-diff.service.js';
import { BlastService } from '../blast/service.js';
import { resolveProjectContext } from '../reviews/project-context.js';
import { BriefRepository, type BriefRow } from './repository.js';
import {
  assembleBriefInput,
  mergeProjectContextInputs,
  type BriefFacts,
  type BriefLinkedIssue,
  type EnabledAgentDocs,
} from './assemble.js';
import { RawRiskBrief, groundBrief } from './grounding.js';
import { activeSkillLinks } from '../agents/effective-config.js';
import {
  BRIEF_DEGRADED_REASONS,
  BRIEF_MAX_TOKENS,
  BRIEF_PROMPT_TEMPLATE,
  BRIEF_TEMPERATURE,
  MAX_ISSUE_BODY_CHARS,
} from './constants.js';

/**
 * L06 — Why+Risk Brief service (application layer).
 *
 * Orchestration only; the deterministic rules live in the pure `assemble.ts`
 * (structured-fact → untrusted prompt + grounding universe) and `grounding.ts`
 * (reference grounding + `risk_level` normalization). Every external dependency
 * (`llm`, `github`, `git`, `db`, and the intent/blast/smart-diff/project-context
 * reads) is reached through the DI container or a service it constructs — never
 * a concrete adapter.
 *
 * SYNCHRONOUS on the POST (mirrors `POST /pulls/:id/intent`): no job, no scanId,
 * no SSE. On a model-call failure it returns a degraded marker at HTTP 200
 * (never a 5xx), preserving any prior brief (AC-16). Persist happens ONLY on a
 * successful generation, all-or-nothing (AC-15/16). Workspace tenancy rests on
 * `reviewRepo.getPull(workspaceId, prId)` BEFORE any `pr_brief` query (AC-19).
 */
export class BriefService {
  private repo: BriefRepository;
  private intents: IntentService;
  private smartDiffs: SmartDiffService;
  private blasts: BlastService;

  constructor(private container: Container) {
    this.repo = new BriefRepository(container.db);
    this.intents = new IntentService(container, container.reviewRepo);
    this.smartDiffs = new SmartDiffService(container.reviewRepo);
    this.blasts = new BlastService(container);
  }

  // ---- Read (zero model calls, AC-5) ---------------------------------------

  /**
   * Read the persisted brief for a PR. Returns `status:'not_generated'` when
   * nothing has ever been generated (AC-17), else the stored brief tagged
   * `fresh`/`stale` against the PR head (AC-14). A cross-workspace PR resolves
   * as 404 via the PR lookup (AC-19). No model call.
   */
  async getBrief(workspaceId: string, prId: string): Promise<BriefResponse> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const row = await this.repo.get(prId);
    if (!row) return { status: 'not_generated' };
    return this.rowToResponse(row, pull.headSha);
  }

  // ---- Generate / Regenerate (exactly one model call, AC-5) ----------------

  /**
   * Generate (or Regenerate) the brief against the PR's current head. `force`
   * (Regenerate) always runs a fresh call; without `force`, a still-fresh
   * stored brief is returned with ZERO model calls (AC-5). On model failure the
   * prior brief is preserved and a degraded marker is returned (AC-16).
   */
  async generateBrief(
    workspaceId: string,
    prId: string,
    force: boolean,
    logger?: PinoLike,
  ): Promise<BriefResponse> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const existing = await this.repo.get(prId);
    // Cost guard: a fresh stored brief needs no new call unless forced (AC-5).
    if (!force && existing && existing.headSha === pull.headSha) {
      return this.rowToResponse(existing, pull.headSha);
    }

    const facts = await this.gatherFacts(workspaceId, prId, pull);
    const { userContent, grounding } = assembleBriefInput(facts);

    const hasInputs =
      grounding.changedFiles.length > 0 ||
      facts.intent != null ||
      facts.linkedIssue != null ||
      facts.projectContextTexts.length > 0 ||
      facts.blast.changed_symbols.length > 0;
    if (!hasInputs) {
      return this.degradedResponse(BRIEF_DEGRADED_REASONS.NO_INPUTS, existing, pull.headSha);
    }

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
    const systemPrompt = await renderPrompt(BRIEF_PROMPT_TEMPLATE, {});

    let result;
    try {
      const llm = await this.container.llm(provider);
      // AC-5: exactly one structured call, low temperature, resolved model.
      result = await llm.completeStructured<RawRiskBrief>({
        model,
        schema: RawRiskBrief,
        schemaName: 'RiskBrief',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: BRIEF_TEMPERATURE,
        maxTokens: BRIEF_MAX_TOKENS,
        sessionId: `brief:${prId}`,
      });
    } catch (err) {
      // AC-16: fail-soft — persist NOTHING, preserve the prior brief, no 5xx.
      logger?.warn({ prId, err: (err as Error).message }, 'risk brief generation failed');
      return this.degradedResponse(BRIEF_DEGRADED_REASONS.MODEL_FAILED, existing, pull.headSha);
    }

    // AC-7/AC-8: drop hallucinated references, normalize risk_level.
    const brief = groundBrief(result.data, grounding);
    const generatedAt = new Date();

    // AC-13/AC-15: persist keyed by PR + head SHA, last-write-wins.
    await this.repo.upsert({
      prId,
      brief,
      headSha: pull.headSha,
      model: result.model,
      costUsd: result.costUsd,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      generatedAt,
    });

    // AC-6: record cost/tokens/model to the run log AND (above) the row.
    new RunLogger(this.container.runBus, [`brief:${prId}`], logger).result('risk brief generated', {
      prId,
      model: result.model,
      costUsd: result.costUsd,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });

    return {
      status: 'fresh',
      brief,
      head_sha: pull.headSha,
      generated_at: generatedAt.toISOString(),
      cost: {
        usd: result.costUsd ?? 0,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        model: result.model,
      },
    };
  }

  // ---- Fact gathering (I/O; assemble/grounding stay pure) ------------------

  private async gatherFacts(
    workspaceId: string,
    prId: string,
    pull: PullRow,
  ): Promise<BriefFacts> {
    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    const repoRef: RepoRef | null = repoRow ? { owner: repoRow.owner, name: repoRow.name } : null;

    // Persisted intent is fail-soft (absent ⇒ null, AC-2); blast + smart-diff
    // are deterministic on-demand reads (they compute from PR files, not from a
    // prior run); the linked issue (AC-4) and project-context resolution (AC-3)
    // are internally fail-soft. The model call — the one failure AC-16 turns
    // into a degraded response — happens later, not here.
    const [intentRec, blast, smartDiff, linkedIssue, projectContextTexts] = await Promise.all([
      this.intents.getIntent(workspaceId, prId).catch(() => null),
      this.blasts.getBlastRadius(workspaceId, prId),
      this.smartDiffs.getSmartDiff(workspaceId, prId),
      repoRef ? this.resolveLinkedIssue(pull, repoRef) : Promise.resolve(null),
      this.resolveProjectContextUnion(workspaceId, repoRef),
    ]);

    const intent: Intent | null = intentRec
      ? { intent: intentRec.intent, in_scope: intentRec.in_scope, out_of_scope: intentRec.out_of_scope }
      : null;

    return { prTitle: pull.title, intent, blast, smartDiff, linkedIssue, projectContextTexts };
  }

  /**
   * Resolve the PR's linked issue LIVE (regex over the body + `github.getIssue`),
   * body-capped, fail-soft on ANY error (no ref, offline, no token, GitHub error)
   * — omitted, never thrown (AC-4). Read via the trusted GitHub client, never a
   * PR-content-derived URL (no SSRF surface).
   */
  private async resolveLinkedIssue(pull: PullRow, repoRef: RepoRef): Promise<BriefLinkedIssue | null> {
    try {
      const match = (pull.body ?? '').match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
      if (!match?.[1]) return null;
      const github = await this.container.github();
      const issue = await github.getIssue(repoRef, Number(match[1]));
      return {
        number: issue.number,
        title: issue.title,
        body: (issue.body ?? '').slice(0, MAX_ISSUE_BODY_CHARS),
      };
    } catch {
      return null;
    }
  }

  /**
   * Project Context = the deduped UNION of attached docs across ALL enabled
   * agents (each agent's own docs ∪ its enabled skills' docs), read FRESH from
   * the clone (AC-3). Zero enabled agents ⇒ no `## Project context` input.
   */
  private async resolveProjectContextUnion(
    workspaceId: string,
    repoRef: RepoRef | null,
  ): Promise<string[]> {
    if (!repoRef) return [];
    const enabledAgents = await this.container.agentsRepo.listEnabled(workspaceId);
    if (enabledAgents.length === 0) return [];

    const agentInputs: EnabledAgentDocs[] = [];
    for (const agent of enabledAgents) {
      const linked = await this.container.agentsRepo.linkedSkills(agent.id);
      // Same single definition of "which skills actually reach the prompt" as
      // the review and eval paths (`agents/effective-config.ts`) — see the note
      // in `reviews/run-executor.ts`.
      const skillDocs = activeSkillLinks(linked).map((l) => l.skill.attachedDocs ?? []);
      agentInputs.push({ attachedDocs: agent.attachedDocs ?? [], skillDocs });
    }

    const { agentDocs, skillDocs } = mergeProjectContextInputs(agentInputs);
    const resolved = await resolveProjectContext(agentDocs, skillDocs, (path) =>
      this.container.git.readFileSafe(repoRef, path),
    );
    return resolved.texts;
  }

  // ---- Response builders ---------------------------------------------------

  private rowToResponse(row: BriefRow, currentHead: string): BriefResponse {
    const status = row.headSha != null && row.headSha === currentHead ? 'fresh' : 'stale';
    return {
      status,
      brief: row.json as RiskBrief,
      head_sha: row.headSha ?? undefined,
      generated_at: row.generatedAt.toISOString(),
      ...(row.model != null ? { cost: this.rowToCost(row) } : {}),
    };
  }

  private rowToCost(row: BriefRow): BriefCost {
    return {
      usd: row.costUsd ?? 0,
      tokens_in: row.tokensIn ?? 0,
      tokens_out: row.tokensOut ?? 0,
      model: row.model ?? '',
    };
  }

  /**
   * A degraded marker (AC-16): the prior brief (if any) is still returned, so
   * the card keeps rendering the last good brief while surfacing the reason.
   */
  private degradedResponse(
    reason: BriefDegradedReason,
    existing: BriefRow | undefined,
    currentHead: string,
  ): BriefResponse {
    if (!existing) return { status: 'degraded', degraded_reason: reason };
    const prior = this.rowToResponse(existing, currentHead);
    return { ...prior, status: 'degraded', degraded_reason: reason };
  }
}
