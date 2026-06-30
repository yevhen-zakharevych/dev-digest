/** L0X — Conventions Extractor: module-local literals. */

export const CONVENTION_EXTRACT_JOB_KIND = 'convention_extract' as const;

/** How many top-ranked source files to feed the model alongside config files. */
export const CONVENTION_SAMPLE_COUNT = 12;

/** Per-file truncation when assembling the sample bundle. */
export const CONVENTION_FILE_LINE_BUDGET = 200;

/** Hard cap on the literal snippet stored per candidate (chars). */
export const CONVENTION_SNIPPET_MAX_CHARS = 600;

/**
 * Slack rows the snippet is allowed to slip outside the cited line range when
 * extracting the literal slice from disk. Models occasionally cite a tight
 * range that misses the surrounding `function` line by one or two; widening a
 * little keeps the evidence useful without inviting noise.
 */
export const CONVENTION_SNIPPET_LINE_SLACK = 2;

/**
 * Repo-root config files we always include in the bundle (when they exist).
 * Globs are matched case-insensitively against the basename, not the path.
 */
export const CONVENTION_CONFIG_GLOBS = [
  'eslint.config.js',
  'eslint.config.cjs',
  'eslint.config.mjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'prettier.config.js',
  'package.json',
];
