import type {
  EvalEffectiveConfig,
  EvalSkillPin,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import type { AgentRow, LinkedSkillRow } from './repository.js';

/**
 * The agent's **effective configuration** — the single source of truth for
 * "what did this agent actually run with", shared by the eval path and (via
 * the same filter rule) the review path.
 *
 * WHY THIS EXISTS — `agent_versions` is NOT it. `agent_versions.config_json`
 * looks purpose-built (its doc comment says "reproducibility for eval") and its
 * snapshot even carries skill ids, but `snapshotVersion` is only ever called
 * from `create()` and `update()` — **never** from `setSkills`. Re-linking an
 * agent's skills therefore bumps no version and writes no snapshot, so the
 * stored snapshot's `skills` array goes stale against the live agent and two
 * runs both tagged `v7` can be measurements of two behaviourally different
 * agents. `agents.version` is a **display label**, never a comparability key
 * (AC-10 / AC-51; see `server/INSIGHTS.md`, first Codebase Patterns entry).
 * Hence: pin the config **by value**, never a version pointer.
 */

export interface ResolvedEffectiveConfig {
  /**
   * The value-pin a run/draft stores (AC-10). Carries skill **identities +
   * versions**, deliberately **no bodies** — a snapshot of every input that
   * shapes behaviour, small enough to store on every run row.
   */
  config: EvalEffectiveConfig;
  /**
   * The resolved skill **bodies**, in prompt order — what the executor feeds
   * `reviewPullRequest` (`reviewer-core/src/review/run.ts:56`, `skills: string[]`).
   * The engine cannot use ids, and the pin must not carry bodies; hence both
   * outputs come out of one resolution, and cannot drift apart.
   */
  skillBodies: string[];
}

/**
 * The skill links that actually reach the prompt, in injection order.
 *
 * The filter is the **review path's own rule**, byte-for-byte:
 * `l.enabled && l.skill.enabled` (`reviews/run-executor.ts:220-222`) — a link
 * may be disabled, and a skill may be globally disabled; either one keeps the
 * body out of the prompt. If the eval path resolved skills differently from the
 * review path, an eval would measure a differently-configured agent than the
 * one that ships (AC-15) — which is the entire point of pinning a config.
 *
 * Ordering is `agent_skills.order` ascending — `AgentsRepository.linkedSkills()`
 * already returns them ordered, but we re-sort so the resolution is a pure
 * function of its input and cannot silently depend on the caller's query.
 */
export function activeSkillLinks(linkedSkills: LinkedSkillRow[]): LinkedSkillRow[] {
  return linkedSkills.filter((l) => l.enabled && l.skill.enabled).sort((a, b) => a.order - b.order);
}

/**
 * Resolve an agent row + its skill links into the two things every eval
 * execution needs: the **value pin** and the **skill bodies**.
 *
 * Pure — no I/O, no `agent_versions` read, no version pointer anywhere.
 */
export function resolveEffectiveConfig(
  agent: AgentRow,
  linkedSkills: LinkedSkillRow[],
): ResolvedEffectiveConfig {
  const active = activeSkillLinks(linkedSkills);

  const skills: EvalSkillPin[] = active.map((l) => ({
    id: l.skill.id,
    name: l.skill.name,
    // The skill's OWN content version — bumped by a body edit, and the only
    // signal that a pinned skill's content has moved on since the run.
    version: l.skill.version,
    order: l.order,
    enabled: l.enabled,
  }));

  return {
    config: {
      system_prompt: agent.systemPrompt,
      provider: agent.provider as Provider,
      model: agent.model,
      strategy: agent.strategy as ReviewStrategy,
      repo_intel: agent.repoIntel,
      skills,
    },
    skillBodies: active.map((l) => l.skill.body),
  };
}
