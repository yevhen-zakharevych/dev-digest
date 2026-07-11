import { describe, it, expect } from 'vitest';
import { RiskBrief } from '@devdigest/shared';
import { groundBrief, normalizeRiskLevel, type GroundingInputs, type RawRiskBrief } from './grounding.js';

/**
 * L06 — Why+Risk Brief grounding (pure, deterministic). Asserts the fixed field
 * set, reference-drop rules (AC-7), and `risk_level` normalization (AC-8). Never
 * asserts LLM `what`/`why`/reason prose.
 */

const inputs: GroundingInputs = {
  changedFiles: ['src/a.ts', 'src/b.ts'],
  riskFiles: ['src/a.ts', 'src/b.ts', 'src/caller.ts'],
  endpoints: ['POST /pulls/:id/brief'],
};

describe('normalizeRiskLevel (AC-8)', () => {
  it('passes through the in-vocabulary values', () => {
    expect(normalizeRiskLevel('high')).toBe('high');
    expect(normalizeRiskLevel('medium')).toBe('medium');
    expect(normalizeRiskLevel('low')).toBe('low');
  });

  it('normalizes case/whitespace', () => {
    expect(normalizeRiskLevel(' HIGH ')).toBe('high');
    expect(normalizeRiskLevel('Low')).toBe('low');
  });

  it('coerces out-of-vocabulary values into the closed set', () => {
    expect(normalizeRiskLevel('critical')).toBe('high');
    expect(normalizeRiskLevel('none')).toBe('low');
    expect(normalizeRiskLevel('banana')).toBe('medium');
  });
});

describe('groundBrief (AC-7/AC-8/AC-9)', () => {
  const raw: RawRiskBrief = {
    what: 'w',
    why: 'y',
    risk_level: 'CRITICAL',
    risks: [
      {
        title: 'grounded file risk',
        explanation: 'e',
        severity: 'high',
        references: [
          { file: 'src/a.ts', line: 10 },
          { file: 'src/ghost.ts', line: 5 }, // absent from riskFiles → dropped
        ],
      },
      {
        title: 'grounded endpoint risk',
        explanation: 'e',
        severity: 'medium',
        references: ['POST /pulls/:id/brief', 'GET /nope'], // second endpoint absent → dropped
      },
      {
        title: 'fully hallucinated risk',
        explanation: 'e',
        severity: 'low',
        references: [{ file: 'src/invented.ts' }], // all refs dropped → whole risk dropped
      },
    ],
    review_focus: [
      { file: 'src/a.ts', line: 12, reason: 'start here' },
      { file: 'src/caller.ts', line: 3, reason: 'not a changed file → dropped' },
      { file: 'src/b.ts', line: null, reason: 'no line → dropped' },
    ],
  };

  const brief = groundBrief(raw, inputs);

  it('emits exactly the five output fields', () => {
    expect(Object.keys(brief).sort()).toEqual(
      ['review_focus', 'risk_level', 'risks', 'what', 'why'].sort(),
    );
    // And the produced object is a valid strict RiskBrief.
    expect(RiskBrief.safeParse(brief).success).toBe(true);
  });

  it('normalizes an out-of-vocab risk_level (AC-8)', () => {
    expect(brief.risk_level).toBe('high');
  });

  it('drops references absent from the inputs and keeps grounded ones (AC-7)', () => {
    const fileRisk = brief.risks.find((r) => r.title === 'grounded file risk');
    expect(fileRisk?.references).toEqual([{ file: 'src/a.ts', line: 10 }]);

    const endpointRisk = brief.risks.find((r) => r.title === 'grounded endpoint risk');
    expect(endpointRisk?.references).toEqual(['POST /pulls/:id/brief']);
  });

  it('drops a risk whose references are ALL ungrounded (AC-9)', () => {
    expect(brief.risks.map((r) => r.title)).not.toContain('fully hallucinated risk');
    expect(brief.risks).toHaveLength(2);
  });

  it('grounds review_focus by changed-file + real line, keeping the emitted line (AC-7/AC-9)', () => {
    expect(brief.review_focus).toEqual([{ file: 'src/a.ts', line: 12, reason: 'start here' }]);
  });
});
