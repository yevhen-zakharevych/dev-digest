/**
 * Pure helpers for building the intent-classifier input (Intent Layer, L03).
 *
 * No I/O: everything here operates purely on its arguments (strings / plain
 * objects in, plain objects/strings out). DB reads, GitHub resolution, and
 * git-file resolution for linked plans/specs live in the (separate) classifier
 * service task — this module only shapes text and extracts references.
 *
 * See `docs/plans/intent-layer.md` §6 (input sources), §7 (token budget), §8
 * (classifier prompt design) for the contract these helpers serve.
 */

/** A minimal changed-file shape sufficient for hunk-header extraction. */
export interface ChangedFileForIntent {
  path: string;
  patch: string | null;
}

/**
 * Extract only the `@@ … @@` hunk-header lines from a unified-diff patch,
 * discarding the diff body. Used so the intent classifier never sees full
 * diff bodies — only the compact per-hunk location/context signal.
 *
 * @param patch - a single file's unified-diff patch text, or null/undefined
 *   when the diff is unavailable (e.g. binary or oversized file).
 * @returns the matched header lines, in order, including any trailing
 *   function-context after the second `@@`. `[]` for null/undefined/empty
 *   input or a patch with no hunk headers.
 */
export function extractHunkHeaders(patch: string | null | undefined): string[] {
  if (!patch) return [];
  return patch.match(/^@@ .*@@.*$/gm) ?? [];
}

/**
 * Render a compact "changed files, hunk headers only" text block for the
 * intent classifier: no diff bodies, just each file's path followed by its
 * hunk-header lines. A file with no resolvable hunks (null patch, or a patch
 * with no `@@` headers — e.g. binary/oversized) is rendered as a single line
 * `path (no hunks available)`.
 *
 * @param files - changed files with their raw patch text (or null).
 * @returns a text block, one file per paragraph, separated by blank lines.
 */
export function formatChangedFiles(files: ChangedFileForIntent[]): string {
  return files
    .map((file) => {
      const headers = extractHunkHeaders(file.patch);
      if (headers.length === 0) return `${file.path} (no hunks available)`;
      return [file.path, ...headers].join('\n');
    })
    .join('\n\n');
}

/** Plan/spec references discovered in a PR body (§6 case resolution). */
export interface PlanRefs {
  /** Numeric `#123` issue/PR references (deduped). */
  githubIssues: number[];
  /** Full `github.com/.../(issues|pull)/N` URLs (deduped). */
  githubUrls: string[];
  /** Relative repo file paths that look like a plan/spec (deduped). */
  repoPaths: string[];
  /** Any other `http(s)://` URL, passed through as a signal, never fetched. */
  externalUrls: string[];
}

const GITHUB_ISSUE_OR_PR_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/\d+/i;

/**
 * Strip trailing punctuation a sentence leaves stuck to a bare URL/path match
 * (e.g. "...see ./PLAN.md." → "./PLAN.md"). Shared by URL and path matching
 * since both regexes include `.`/`,` etc. in their character class.
 */
function trimTrailingPunctuation(candidate: string): string {
  return candidate.replace(/[),.;:!?]+$/, '');
}

/** True if `candidate` (already trimmed) is a plan/spec-shaped repo path. */
function looksLikePlanPath(candidate: string): boolean {
  const p = candidate.trim();
  if (!p || /^https?:\/\//i.test(p)) return false;
  return /\.md$/i.test(p) || /(^|\/)(specs|docs)\//i.test(p) || /^(specs|docs)\//i.test(p);
}

/** Drop a leading `./` so `./PLAN.md` and `PLAN.md` dedup to one entry. */
function normalizePath(p: string): string {
  return p.replace(/^\.\//, '');
}

/** Classify a bare URL (already extracted, not inside markdown-link syntax). */
function classifyUrl(rawUrl: string, githubUrls: Set<string>, externalUrls: Set<string>): void {
  const url = trimTrailingPunctuation(rawUrl);
  if (GITHUB_ISSUE_OR_PR_URL_RE.test(url)) {
    githubUrls.add(url);
  } else {
    externalUrls.add(url);
  }
}

/** Classify a markdown-link target `[label](target)` — URL or repo path. */
function classifyLinkTarget(
  target: string,
  githubUrls: Set<string>,
  repoPaths: Set<string>,
  externalUrls: Set<string>,
): void {
  const clean = target.trim();
  if (/^https?:\/\//i.test(clean)) {
    classifyUrl(clean, githubUrls, externalUrls);
    return;
  }
  if (looksLikePlanPath(clean)) {
    repoPaths.add(normalizePath(clean));
  }
}

/**
 * Parse a PR body for references to a plan/spec/issue (§6). Per §11 decision
 * A, external (non-GitHub, non-repo-path) URLs are only classified as a
 * signal here — they are never fetched (SSRF avoidance; resolution of
 * repo-internal paths and GitHub issues/PRs happens elsewhere, over adapters
 * that are already scoped/trusted).
 *
 * Robust to bare URLs and markdown-link syntax `[label](target)`. Every
 * output array is deduped.
 *
 * @param body - the PR body text, or null/undefined/empty (never an error —
 *   returns all-empty arrays).
 */
export function extractPlanRefs(body: string | null | undefined): PlanRefs {
  const githubIssues = new Set<number>();
  const githubUrls = new Set<string>();
  const repoPaths = new Set<string>();
  const externalUrls = new Set<string>();

  if (!body) {
    return { githubIssues: [], githubUrls: [], repoPaths: [], externalUrls: [] };
  }

  // 1. `#123` issue refs — scanned on the raw body since they may appear
  //    inside a markdown-link label, e.g. `[Fixes #123](...)`.
  for (const m of body.matchAll(/#(\d+)/g)) {
    githubIssues.add(Number(m[1]));
  }

  // 2. Markdown links `[label](target)` — classify the target, then blank it
  //    out so step 3/4 don't re-match the same text as a bare URL/path.
  let remaining = body.replace(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, (_match, target: string) => {
    classifyLinkTarget(target, githubUrls, repoPaths, externalUrls);
    return ' ';
  });

  // 3. Bare URLs.
  remaining = remaining.replace(/https?:\/\/[^\s)>\]"'`]+/g, (match) => {
    classifyUrl(match, githubUrls, externalUrls);
    return ' ';
  });

  // 4. Bare repo paths (whatever text is left after links/URLs are removed).
  //    Trim trailing sentence punctuation (e.g. "./PLAN.md.") before testing —
  //    the path regex greedily includes it since '.' is a valid path char.
  for (const m of remaining.matchAll(/(?:\.\/)?(?:[\w.-]+\/)+[\w.-]+(?:\.[A-Za-z0-9]+)?|\b[\w.-]+\.md\b/g)) {
    const candidate = trimTrailingPunctuation(m[0]);
    if (looksLikePlanPath(candidate)) repoPaths.add(normalizePath(candidate));
  }

  return {
    githubIssues: Array.from(githubIssues).sort((a, b) => a - b),
    githubUrls: Array.from(githubUrls),
    repoPaths: Array.from(repoPaths),
    externalUrls: Array.from(externalUrls),
  };
}

/**
 * Cheap character-based token approximation (matches the client-side
 * convention). Not a tokenizer — good enough for a "tokens saved" log line.
 */
export function approxTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

/** Full-patch vs hunk-header-only approximate token comparison. */
export interface HunkTokenSavings {
  /** Approx tokens of the full patches — ONLY files that actually have one. */
  fullTokens: number;
  /** Approx tokens of the hunk-header lines kept for those same files. */
  hunkTokens: number;
  /** `fullTokens - hunkTokens`; always ≥ 0. 0 when no file has a diff body. */
  saved: number;
  /** Count of changed files that had a non-empty patch (a diff body to trim). */
  filesWithPatch: number;
}

/**
 * Compute the approximate token savings of sending hunk headers only vs the
 * full diff bodies, for logging at classify time (§8 "Tokens-saved log").
 *
 * Measured ONLY over files that actually carry a patch, and compares the full
 * patch against the hunk-header lines we keep from *that* patch (not the
 * rendered {@link formatChangedFiles} block, which adds path framing and
 * `(no hunks available)` placeholders). This keeps the comparison apples-to-
 * apples so `saved` is inherently ≥ 0 (headers are a subset of the patch), and
 * returns all-zero for a PR with no diff bodies (e.g. seeded/large/binary
 * files) instead of a misleading negative "savings".
 */
export function hunkTokenSavings(files: ChangedFileForIntent[]): HunkTokenSavings {
  const withPatch = files.filter((file) => file.patch != null && file.patch.trim().length > 0);
  if (withPatch.length === 0) {
    return { fullTokens: 0, hunkTokens: 0, saved: 0, filesWithPatch: 0 };
  }
  const fullTokens = approxTokens(withPatch.map((file) => file.patch ?? '').join('\n'));
  const hunkTokens = approxTokens(
    withPatch.map((file) => extractHunkHeaders(file.patch).join('\n')).join('\n'),
  );
  return {
    fullTokens,
    hunkTokens,
    saved: Math.max(0, fullTokens - hunkTokens),
    filesWithPatch: withPatch.length,
  };
}
