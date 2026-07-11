import { describe, it, expect } from 'vitest';
import type { OnboardingSection } from '@devdigest/shared';
import { normalizeSections, isValidMermaid, type NormalizeContext } from './normalize.js';

function section(kind: string, over: Partial<OnboardingSection> = {}): OnboardingSection {
  return { kind, title: `${kind} title`, body: `${kind} body`, diagram: null, links: [], ...over };
}

const emptyCtx: NormalizeContext = { validPaths: new Set(), readingPathOrder: [] };

describe('onboarding normalize — 5-kind vocabulary + order (AC-2)', () => {
  it('drops unknown kinds and keeps only the fixed five', () => {
    const raw = [
      section('architecture'),
      section('totally_made_up'),
      section('first_tasks'),
    ];
    const out = normalizeSections(raw, emptyCtx);
    expect(out.map((s) => s.kind)).toEqual(['architecture', 'first_tasks']);
  });

  it('reorders a shuffled model output into the canonical order', () => {
    const raw = [
      section('first_tasks'),
      section('run_locally'),
      section('architecture'),
      section('reading_path'),
      section('critical_paths'),
    ];
    const out = normalizeSections(raw, emptyCtx);
    expect(out.map((s) => s.kind)).toEqual([
      'architecture',
      'critical_paths',
      'run_locally',
      'reading_path',
      'first_tasks',
    ]);
  });

  it('drops duplicate kinds, keeping the first occurrence', () => {
    const raw = [
      section('architecture', { title: 'first' }),
      section('architecture', { title: 'second' }),
    ];
    const out = normalizeSections(raw, emptyCtx);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('first');
  });
});

describe('onboarding normalize — diagram rules (AC-3)', () => {
  const ctx = emptyCtx;

  it('keeps a valid mermaid diagram only on architecture', () => {
    const out = normalizeSections(
      [section('architecture', { diagram: 'flowchart TD\n  A-->B' })],
      ctx,
    );
    expect(out[0]!.diagram).toBe('flowchart TD\n  A-->B');
  });

  it('forces every non-architecture diagram to null', () => {
    const out = normalizeSections(
      [section('critical_paths', { diagram: 'flowchart TD\n  A-->B' })],
      ctx,
    );
    expect(out[0]!.diagram).toBeNull();
  });

  it('drops an invalid architecture diagram but keeps the prose', () => {
    const out = normalizeSections(
      [section('architecture', { diagram: 'not a real diagram', body: 'keep me' })],
      ctx,
    );
    expect(out[0]!.diagram).toBeNull();
    expect(out[0]!.body).toBe('keep me');
  });

  it('validity heuristic: fences and unknown headers are rejected', () => {
    expect(isValidMermaid('flowchart LR\n A-->B')).toBe(true);
    expect(isValidMermaid('graph TD\n A-->B')).toBe(true);
    expect(isValidMermaid('sequenceDiagram\n A->>B: x')).toBe(true);
    expect(isValidMermaid('```mermaid\nflowchart TD\n```')).toBe(false);
    expect(isValidMermaid('pie title x')).toBe(false);
    expect(isValidMermaid('')).toBe(false);
    expect(isValidMermaid(null)).toBe(false);
  });
});

describe('onboarding normalize — link grounding (AC-4)', () => {
  it('drops links whose path is not a real repo path', () => {
    const ctx: NormalizeContext = {
      validPaths: new Set(['src/real.ts', 'README.md']),
      readingPathOrder: [],
    };
    const out = normalizeSections(
      [
        section('critical_paths', {
          links: [
            { label: 'real', path: 'src/real.ts' },
            { label: 'invented', path: 'src/ghost.ts' },
            { label: 'doc', path: 'README.md' },
          ],
        }),
      ],
      ctx,
    );
    expect(out[0]!.links.map((l) => l.path)).toEqual(['src/real.ts', 'README.md']);
  });
});

describe('onboarding normalize — reading path order (AC-6)', () => {
  it('reorders reading_path links to descending rank and drops un-ranked links', () => {
    const ctx: NormalizeContext = {
      validPaths: new Set(['a.ts', 'b.ts', 'c.ts', 'z.ts']),
      readingPathOrder: ['a.ts', 'b.ts', 'c.ts'], // descending rank
    };
    const out = normalizeSections(
      [
        section('reading_path', {
          links: [
            { label: 'c', path: 'c.ts' },
            { label: 'a', path: 'a.ts' },
            { label: 'z', path: 'z.ts' }, // valid path but not rank-ordered → dropped
            { label: 'b', path: 'b.ts' },
          ],
        }),
      ],
      ctx,
    );
    expect(out[0]!.links.map((l) => l.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});
