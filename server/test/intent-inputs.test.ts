import { describe, it, expect } from 'vitest';
import {
  extractHunkHeaders,
  formatChangedFiles,
  extractPlanRefs,
  approxTokens,
  hunkTokenSavings,
} from '../src/modules/reviews/intent-inputs.js';

/**
 * Pure hermetic coverage for the Intent Layer's classifier-input helpers
 * (`docs/plans/intent-layer.md` §6-§8, task C1). No I/O — everything here is
 * string-in/string-out, so this suite is a plain `*.test.ts` (not `.it.test.ts`).
 */

describe('extractHunkHeaders', () => {
  it('extracts only the @@ … @@ header lines from a multi-hunk patch, preserving trailing function context', () => {
    const patch = [
      '@@ -10,3 +10,4 @@',
      '   port: 3000,',
      '+  stripeKey: "sk_live_xxx",',
      '   redisUrl: x,',
      '@@ -50,2 +51,3 @@ function configure() {',
      '   more code',
      '+  added line',
    ].join('\n');

    expect(extractHunkHeaders(patch)).toEqual([
      '@@ -10,3 +10,4 @@',
      '@@ -50,2 +51,3 @@ function configure() {',
    ]);
  });

  it('returns [] for null, undefined, and empty patches', () => {
    expect(extractHunkHeaders(null)).toEqual([]);
    expect(extractHunkHeaders(undefined)).toEqual([]);
    expect(extractHunkHeaders('')).toEqual([]);
  });

  it('returns [] for a patch with no hunk headers (e.g. a binary-file placeholder)', () => {
    expect(extractHunkHeaders('Binary files a/img.png and b/img.png differ')).toEqual([]);
  });
});

describe('formatChangedFiles', () => {
  it('renders a file with hunks as its path followed by its hunk headers', () => {
    const files = [
      {
        path: 'src/config.ts',
        patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
      },
    ];
    expect(formatChangedFiles(files)).toBe('src/config.ts\n@@ -10,3 +10,4 @@');
  });

  it('renders a file with a null patch as "path (no hunks available)"', () => {
    const files = [{ path: 'assets/logo.png', patch: null }];
    expect(formatChangedFiles(files)).toBe('assets/logo.png (no hunks available)');
  });

  it('joins multiple files as separate paragraphs', () => {
    const files = [
      { path: 'a.ts', patch: '@@ -1,1 +1,1 @@' },
      { path: 'b.png', patch: null },
    ];
    expect(formatChangedFiles(files)).toBe('a.ts\n@@ -1,1 +1,1 @@\n\nb.png (no hunks available)');
  });
});

describe('extractPlanRefs', () => {
  it('returns all-empty arrays for null/undefined/empty body', () => {
    for (const body of [null, undefined, '']) {
      expect(extractPlanRefs(body)).toEqual({
        githubIssues: [],
        githubUrls: [],
        repoPaths: [],
        externalUrls: [],
      });
    }
  });

  it('extracts bare #N issue refs, deduped and sorted', () => {
    const body = 'Fixes #123 and also relates to #45. See #123 again.';
    const refs = extractPlanRefs(body);
    expect(refs.githubIssues).toEqual([45, 123]);
  });

  it('extracts full github.com issue/pull URLs into githubUrls, not externalUrls', () => {
    const body = [
      'Spec discussion: https://github.com/acme/repo/issues/456',
      'Depends on https://github.com/acme/repo/pull/789',
    ].join('\n');
    const refs = extractPlanRefs(body);
    expect(refs.githubUrls).toEqual(
      expect.arrayContaining([
        'https://github.com/acme/repo/issues/456',
        'https://github.com/acme/repo/pull/789',
      ]),
    );
    expect(refs.externalUrls).toEqual([]);
  });

  it('extracts bare repo paths under specs/ and docs/, and any *.md path', () => {
    const body = 'See specs/intent-layer.md and docs/architecture.md and also root-level PLAN.md.';
    const refs = extractPlanRefs(body);
    expect(refs.repoPaths).toEqual(
      expect.arrayContaining(['specs/intent-layer.md', 'docs/architecture.md']),
    );
  });

  it('extracts a markdown-link target as a repo path', () => {
    const body = 'Full design in [the plan](docs/PLAN.md) before you start.';
    const refs = extractPlanRefs(body);
    expect(refs.repoPaths).toContain('docs/PLAN.md');
  });

  it('trims trailing sentence punctuation from a bare path before classifying it', () => {
    // Regression: the path charset includes '.', so a naive match on
    // "./PLAN.md." (sentence-final period) would fail the /\.md$/ suffix
    // check unless trimmed first (server/INSIGHTS.md:26).
    const body = 'The full design is written up, see ./PLAN.md.';
    const refs = extractPlanRefs(body);
    expect(refs.repoPaths).toContain('PLAN.md');
    expect(refs.repoPaths).not.toContain('PLAN.md.');
  });

  it('buckets a non-GitHub, non-repo-path URL as an external signal, separate from githubUrls', () => {
    const body = 'Full spec lives at https://www.notion.so/acme/plan-doc-123 (auth required).';
    const refs = extractPlanRefs(body);
    expect(refs.externalUrls).toContain('https://www.notion.so/acme/plan-doc-123');
    expect(refs.githubUrls).toEqual([]);
  });

  it('dedupes every output array even when a reference appears multiple times across bare text and markdown links', () => {
    const body = [
      'Fixes #10. Fixes #10 again.',
      'See https://github.com/acme/repo/issues/10 and https://github.com/acme/repo/issues/10.',
      'Plan: [here](specs/plan.md) and again specs/plan.md.',
    ].join('\n');
    const refs = extractPlanRefs(body);
    expect(refs.githubIssues).toEqual([10]);
    expect(refs.githubUrls).toEqual(['https://github.com/acme/repo/issues/10']);
    expect(refs.repoPaths).toEqual(['specs/plan.md']);
  });
});

describe('approxTokens', () => {
  it('approximates ~4 chars per token', () => {
    expect(approxTokens('a'.repeat(400))).toBe(100);
  });

  it('never returns less than 1, even for empty input', () => {
    expect(approxTokens('')).toBe(1);
  });
});

describe('hunkTokenSavings', () => {
  it('reports a positive token saving on a realistic multi-file patch (hunk headers only vs full diff bodies)', () => {
    const verboseBody = Array.from({ length: 20 }, (_, i) => `   context line ${i} unchanged`).join('\n');
    const files = [
      {
        path: 'src/config.ts',
        patch: `@@ -10,3 +10,4 @@\n${verboseBody}\n+  stripeKey: "sk_live_xxx",\n${verboseBody}`,
      },
      {
        path: 'src/routes/index.ts',
        patch: `@@ -1,5 +1,8 @@ function registerRoutes() {\n${verboseBody}\n+  app.use(limiter);\n${verboseBody}`,
      },
      { path: 'assets/logo.png', patch: null },
    ];

    const savings = hunkTokenSavings(files);
    expect(savings.fullTokens).toBeGreaterThan(savings.hunkTokens);
    expect(savings.saved).toBeGreaterThan(0);
    expect(savings.saved).toBe(savings.fullTokens - savings.hunkTokens);
    expect(savings.filesWithPatch).toBe(2); // the two patched files; the null-patch png excluded
  });

  it('reports zero saving (never negative) when no changed file has a patch body', () => {
    // Seeded PRs / large / binary files arrive with null patches. The old
    // formula compared empty full-patches against the rendered "(no hunks
    // available)" placeholder block and logged a misleading negative saving.
    const files = [
      { path: 'src/middleware/ratelimit.ts', patch: null },
      { path: 'src/api/public/webhooks.ts', patch: null },
    ];

    const savings = hunkTokenSavings(files);
    expect(savings.filesWithPatch).toBe(0);
    expect(savings.fullTokens).toBe(0);
    expect(savings.hunkTokens).toBe(0);
    expect(savings.saved).toBe(0);
  });
});
