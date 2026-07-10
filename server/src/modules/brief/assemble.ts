import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { BlastRadius, Intent, SmartDiff } from '@devdigest/shared';
import type { GroundingInputs } from './grounding.js';

/**
 * L06 — Why+Risk Brief INPUT ASSEMBLY (pure, no I/O).
 *
 * Turns the already-computed STRUCTURED SUMMARIES (persisted intent,
 * deterministic blast summary, smart-diff role/stats, live linked issue,
 * attached Project Context specs) into the single untrusted-wrapped user
 * message for the `risk_brief` call, and derives the grounding reference
 * universe from those SAME facts (so grounding can never disagree with the
 * prompt). The RAW DIFF HUNKS are never an input (AC-1) — none of the inputs
 * carry hunk text, so a PR with huge hunks yields an input bounded by the
 * summaries, not the diff.
 *
 * All repo/PR/third-party-derived text (intent, issue body, spec text,
 * blast/smart-diff-derived strings) is fenced via `wrapUntrusted` and treated
 * as data, never instructions (AC-18); the injection guard lives in the system
 * prompt (`brief.system.md`).
 */

/** A linked GitHub issue, already fetched + body-capped by the service (AC-4). */
export interface BriefLinkedIssue {
  number: number;
  title: string;
  body: string;
}

/** The structured facts the brief is assembled from — no diff hunks (AC-1). */
export interface BriefFacts {
  prTitle: string;
  /** Persisted intent, or `null` when none has been classified (AC-2). */
  intent: Intent | null;
  blast: BlastRadius;
  smartDiff: SmartDiff;
  /** Live linked issue, or `null` when unresolvable/omitted (AC-4). */
  linkedIssue: BriefLinkedIssue | null;
  /**
   * Project Context spec texts (already `Source: <path>`-labeled by
   * `resolveProjectContext`), the deduped UNION across all enabled agents +
   * their enabled skills (AC-3). Empty when zero agents are enabled.
   */
  projectContextTexts: string[];
}

export interface AssembledBrief {
  /** The single untrusted-wrapped user message. */
  userContent: string;
  /** The reference universe grounding checks the model output against (AC-7). */
  grounding: GroundingInputs;
}

// ---- Project-context union across enabled agents (AC-3) --------------------

/** One enabled agent's attach set: its own docs + its enabled skills' doc lists. */
export interface EnabledAgentDocs {
  attachedDocs: string[];
  skillDocs: string[][];
}

/**
 * Flatten every enabled agent's attach set into the `(agentDocs, skillDocs)`
 * pair `resolveProjectContext` consumes — the deduped UNION across ALL enabled
 * agents (not the first-enabled), AC-3. Dedupe-by-path is left to
 * `resolveProjectContext` (which already dedupes across the whole union).
 */
export function mergeProjectContextInputs(
  agents: EnabledAgentDocs[],
): { agentDocs: string[]; skillDocs: string[][] } {
  const agentDocs: string[] = [];
  const skillDocs: string[][] = [];
  for (const agent of agents) {
    agentDocs.push(...agent.attachedDocs);
    for (const docs of agent.skillDocs) skillDocs.push(docs);
  }
  return { agentDocs, skillDocs };
}

// ---- Fact → prompt rendering (deterministic) -------------------------------

function renderIntent(intent: Intent): string {
  const lines = [intent.intent];
  if (intent.in_scope.length > 0) {
    lines.push('', 'In scope:', ...intent.in_scope.map((s) => `- ${s}`));
  }
  if (intent.out_of_scope.length > 0) {
    lines.push('', 'Out of scope:', ...intent.out_of_scope.map((s) => `- ${s}`));
  }
  return lines.join('\n');
}

function renderBlast(blast: BlastRadius): string {
  const lines = [blast.summary];
  if (blast.changed_symbols.length > 0) {
    lines.push('', 'Changed symbols:');
    for (const s of blast.changed_symbols) lines.push(`- ${s.kind} ${s.name} (${s.file})`);
  }
  for (const impact of blast.downstream) {
    lines.push('', `Downstream of ${impact.symbol}:`);
    for (const caller of impact.callers) lines.push(`- caller ${caller.name} at ${caller.file}:${caller.line}`);
    if (impact.endpoints_affected.length > 0) {
      lines.push(`- endpoints: ${impact.endpoints_affected.join(', ')}`);
    }
    if (impact.crons_affected.length > 0) {
      lines.push(`- crons: ${impact.crons_affected.join(', ')}`);
    }
  }
  if (blast.prior_prs.length > 0) {
    lines.push('', `Prior PRs touching these files: ${blast.prior_prs.length}`);
  }
  return lines.join('\n');
}

function renderSmartDiff(smartDiff: SmartDiff): string {
  const lines: string[] = [];
  for (const group of smartDiff.groups) {
    lines.push(`Role: ${group.role}`);
    for (const file of group.files) {
      const findings = file.finding_lines.length > 0 ? ` — finding lines ${file.finding_lines.join(', ')}` : '';
      lines.push(`- ${file.path} (+${file.additions}/-${file.deletions})${findings}`);
    }
  }
  const split = smartDiff.split_suggestion;
  if (split.too_big) {
    lines.push('', `Split suggestion: PR is large (${split.total_lines} lines).`);
    for (const proposed of split.proposed_splits) {
      lines.push(`- ${proposed.name}: ${proposed.files.join(', ')}`);
    }
  }
  return lines.join('\n');
}

// ---- Grounding-input derivation --------------------------------------------

function deriveGroundingInputs(facts: BriefFacts): GroundingInputs {
  const changedFiles = new Set<string>();
  for (const group of facts.smartDiff.groups) {
    for (const file of group.files) changedFiles.add(file.path);
  }

  const riskFiles = new Set<string>(changedFiles);
  for (const s of facts.blast.changed_symbols) riskFiles.add(s.file);
  for (const impact of facts.blast.downstream) {
    for (const caller of impact.callers) riskFiles.add(caller.file);
  }

  const endpoints = new Set<string>();
  for (const impact of facts.blast.downstream) {
    for (const e of impact.endpoints_affected) endpoints.add(e);
    for (const c of impact.crons_affected) endpoints.add(c);
  }

  return {
    changedFiles: [...changedFiles],
    riskFiles: [...riskFiles],
    endpoints: [...endpoints],
  };
}

/**
 * Assemble the untrusted-wrapped user message + the grounding reference set
 * from the structured facts. No raw diff hunks are ever included (AC-1).
 */
export function assembleBriefInput(facts: BriefFacts): AssembledBrief {
  const parts: string[] = [`## PR title\n${wrapUntrusted('pr-title', facts.prTitle)}`];

  parts.push(
    facts.intent
      ? `## Intent\n${wrapUntrusted('intent', renderIntent(facts.intent))}`
      : '## Intent\nNo persisted intent for this PR.',
  );

  parts.push(`## Blast radius (deterministic summary)\n${wrapUntrusted('blast', renderBlast(facts.blast))}`);
  parts.push(`## Smart diff (roles + statistics)\n${wrapUntrusted('smart-diff', renderSmartDiff(facts.smartDiff))}`);

  if (facts.linkedIssue) {
    const issue = `#${facts.linkedIssue.number} ${facts.linkedIssue.title}\n${facts.linkedIssue.body}`;
    parts.push(`## Linked issue\n${wrapUntrusted('linked-issue', issue)}`);
  }

  if (facts.projectContextTexts.length > 0) {
    const specs = facts.projectContextTexts
      .map((text) => wrapUntrusted('project-context', text))
      .join('\n\n');
    parts.push(`## Project context\n${specs}`);
  }

  parts.push(
    'Write the brief grounded ONLY in the FACTS above. Cite only file paths and endpoints ' +
      'that appear in the input; never invent a file, line, or endpoint.',
  );

  return { userContent: parts.join('\n\n'), grounding: deriveGroundingInputs(facts) };
}
