import { describe, it, expect } from 'vitest';
import type { BlastRadius, Intent, SmartDiff } from '@devdigest/shared';
import {
  assembleBriefInput,
  mergeProjectContextInputs,
  type BriefFacts,
  type EnabledAgentDocs,
} from './assemble.js';

/**
 * L06 — Why+Risk Brief input assembly (pure, deterministic). Asserts the input
 * carries the STRUCTURED summaries and NO raw diff-hunk text (AC-1), untrusted
 * wrapping (AC-18), the Project-Context-is-union rule (AC-3), and the derived
 * grounding reference set (AC-7). Never asserts LLM output prose.
 */

const blast: BlastRadius = {
  changed_symbols: [{ name: 'rateLimit', file: 'src/middleware/ratelimit.ts', kind: 'function' }],
  downstream: [
    {
      symbol: 'rateLimit',
      callers: [{ name: 'webhookHandler', file: 'src/api/public/webhooks.ts', line: 42 }],
      endpoints_affected: ['POST /webhooks'],
      crons_affected: ['nightly-sweep'],
    },
  ],
  summary: 'BLAST_SUMMARY_MARKER: 1 changed symbol affects 1 caller group',
  prior_prs: [],
};

const smartDiff: SmartDiff = {
  groups: [
    {
      role: 'core',
      files: [{ path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0, finding_lines: [12] }],
    },
    {
      role: 'wiring',
      files: [{ path: 'src/config.ts', additions: 4, deletions: 0, finding_lines: [] }],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 88, proposed_splits: [] },
};

const intent: Intent = {
  intent: 'INTENT_MARKER: add rate limiting',
  in_scope: ['public endpoints'],
  out_of_scope: ['auth changes'],
};

function facts(over: Partial<BriefFacts> = {}): BriefFacts {
  return {
    prTitle: 'Add rate limiting',
    intent,
    blast,
    smartDiff,
    linkedIssue: { number: 7, title: 'ISSUE_MARKER rate limits', body: 'we need limits' },
    projectContextTexts: [],
    ...over,
  };
}

describe('assembleBriefInput (AC-1/AC-18)', () => {
  it('carries the structured summaries and NO raw diff-hunk text', () => {
    const { userContent } = assembleBriefInput(facts());
    expect(userContent).toContain('BLAST_SUMMARY_MARKER');
    expect(userContent).toContain('INTENT_MARKER');
    expect(userContent).toContain('ISSUE_MARKER');
    expect(userContent).toContain('src/middleware/ratelimit.ts');
    expect(userContent).toContain('POST /webhooks');
    // No hunk headers / patch bodies ever reach the input (AC-1).
    expect(userContent).not.toContain('@@');
  });

  it('fences every untrusted input (AC-18)', () => {
    const { userContent } = assembleBriefInput(facts());
    expect(userContent).toContain('<untrusted');
  });

  it('marks intent absent without failing (AC-2)', () => {
    const { userContent } = assembleBriefInput(facts({ intent: null }));
    expect(userContent).toContain('No persisted intent');
    expect(userContent).not.toContain('INTENT_MARKER');
  });

  it('includes the project-context specs when present, fenced untrusted (AC-3)', () => {
    const { userContent } = assembleBriefInput(
      facts({ projectContextTexts: ['Source: docs/spec.md\n\nSPEC_MARKER body'] }),
    );
    expect(userContent).toContain('## Project context');
    expect(userContent).toContain('SPEC_MARKER');
  });

  it('omits the project-context section when there are no specs (AC-3, zero enabled agents)', () => {
    const { userContent } = assembleBriefInput(facts({ projectContextTexts: [] }));
    expect(userContent).not.toContain('## Project context');
  });
});

describe('assembleBriefInput grounding derivation (AC-7)', () => {
  it('derives changed files from smart-diff, risk files incl. blast callers, endpoints from blast', () => {
    const { grounding } = assembleBriefInput(facts());
    expect(grounding.changedFiles.sort()).toEqual(['src/config.ts', 'src/middleware/ratelimit.ts']);
    expect(grounding.riskFiles).toContain('src/api/public/webhooks.ts'); // blast caller file
    expect(grounding.endpoints.sort()).toEqual(['POST /webhooks', 'nightly-sweep'].sort());
  });
});

describe('mergeProjectContextInputs (AC-3 — union across ALL enabled agents)', () => {
  it('unions each enabled agent\'s docs and its enabled skills\' docs', () => {
    const agents: EnabledAgentDocs[] = [
      { attachedDocs: ['docs/a.md'], skillDocs: [['docs/skill1.md']] },
      { attachedDocs: ['docs/b.md'], skillDocs: [['docs/skill2.md'], ['docs/a.md']] },
    ];
    const { agentDocs, skillDocs } = mergeProjectContextInputs(agents);
    expect(agentDocs).toEqual(['docs/a.md', 'docs/b.md']);
    // Every enabled skill doc list is carried through (dedupe-by-path is done by
    // resolveProjectContext across the whole union).
    expect(skillDocs).toEqual([['docs/skill1.md'], ['docs/skill2.md'], ['docs/a.md']]);
  });
});
