/**
 * File-path risk classifier for Smart Diff (L03) — the single source of truth.
 *
 * Pure and dependency-free (plain RegExp, no minimatch/glob): classifies a
 * changed file into one of three review-risk roles by PATH ALONE —
 *   - `boilerplate` — lockfiles, build output, vendored/generated code, DB
 *                     migrations, snapshots (skim, don't review)
 *   - `wiring`      — config + barrel/index files (hooks the core into the app)
 *   - `core`        — everything else (the business logic — review closely)
 *
 * Every RegExp is matched against BOTH the full posix-style path and the bare
 * basename, so a pattern only needs to describe whichever shape is natural
 * (a dir segment like `dist/`, or a bare filename like `pnpm-lock.yaml`).
 *
 * Precedence is boilerplate → wiring → core (most-specific / lowest-review-
 * value first): a lockfile inside a config-looking directory still classifies
 * as boilerplate, never wiring.
 *
 * The Smart Diff composer (`../reviews/smart-diff.classify.ts`) imports
 * `classifyFile` from here — do NOT duplicate these pattern lists elsewhere.
 * `docs/plans/smart-diff.md` §5 "Classification algorithm" is the spec.
 */
import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Boilerplate: lockfiles, build output, vendored/generated code, DB migrations,
 * snapshots. Checked FIRST — most-specific/lowest-review-value wins.
 */
export const BOILERPLATE_PATTERNS: RegExp[] = [
  // Lockfiles (exact basenames).
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)go\.sum$/,

  // Build output directories.
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)out\//,
  /(^|\/)\.next\//,
  /(^|\/)coverage\//,

  // Vendored / generated code.
  /(^|\/)node_modules\//,
  /(^|\/)vendor\//,
  /\.min\.js$/,
  /\.map$/,
  /\.generated\./,

  // DB migrations (drizzle-kit output): the numbered `.sql` files AND the
  // `meta/` snapshots — all generated, all boilerplate to a reviewer.
  /(^|\/)migrations\//,
  /(^|\/)\d+_[^/]*\.sql$/,

  // Snapshots.
  /(^|\/)__snapshots__\//,
  /\.snap$/,
];

/**
 * Wiring: config files and barrel/index files. Checked SECOND — after
 * boilerplate, before the `core` default.
 */
export const WIRING_PATTERNS: RegExp[] = [
  // Config files.
  /\.config\.(js|ts|mjs|cjs)$/,
  /(^|\/)tsconfig.*\.json$/,
  /(^|\/)package\.json$/,
  /(^|\/)\.eslintrc/,
  /(^|\/)\.prettierrc/,
  /(^|\/)\.env/,
  /(^|\/)Dockerfile$/,
  /(^|\/)docker-compose.*\.ya?ml$/,
  /(^|\/)\.github\//,
  /\.ya?ml$/,

  // Barrels / index files (basename only).
  /^index\.ts$/,
  /^index\.js$/,
];

/** Return `path`'s basename (text after the last `/`, or the whole string). */
function basename(path: string): string {
  const slashIdx = path.lastIndexOf('/');
  return slashIdx === -1 ? path : path.slice(slashIdx + 1);
}

/** True if `path` or its basename matches any pattern in `patterns`. */
function matchesAny(patterns: RegExp[], path: string): boolean {
  const base = basename(path);
  return patterns.some((re) => re.test(path) || re.test(base));
}

/**
 * Classify a single changed file's review-risk role by path/pattern only —
 * independent of repo-intel (`docs/plans/smart-diff.md` §9 assumption 4).
 * Returns `'boilerplate' | 'wiring' | 'core'`.
 */
export function classifyFile(path: string): SmartDiffRole {
  if (matchesAny(BOILERPLATE_PATTERNS, path)) return 'boilerplate';
  if (matchesAny(WIRING_PATTERNS, path)) return 'wiring';
  return 'core';
}
