/**
 * INFRASTRUCTURE — reads the prebuilt CI runner off disk (AC-6a, AC-8).
 *
 * This is the ONLY file in `modules/ci/` that touches `fs`. `service.ts` never
 * imports it directly: the reader arrives through the DI container
 * (`platform/container.ts`), so tests inject a stub via `ContainerOverrides`
 * and drive both the "bundle present" and the "bundle missing" branch without a
 * build step. That matters — `agent-runner/dist/` is not in git, so AC-8's
 * failure branch is the DEFAULT state of a fresh checkout.
 *
 * NEVER ALLOWLIST FILENAMES. The build emits `index.js` **plus** a
 * `package.json` declaring the module type (without which the entrypoint dies
 * with `SyntaxError: Cannot use import statement outside a module` in any target
 * repo that does not opt into ES modules — verified by execution) **plus**
 * lazily-loaded chunks whose names change with `agent-runner`'s dependencies. A
 * hardcoded list therefore silently ships a broken runner after a future build.
 * Everything in the directory goes, verbatim.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigError } from '../../platform/errors.js';
import type { RunnerFile } from './bundle.js';

/**
 * Port for "give me the prebuilt runner's files". Registered on the container
 * like `auth` so `ContainerOverrides.runnerBundle` can replace it wholesale.
 */
export interface RunnerBundleReader {
  /**
   * Every file of the prebuilt runner, as `{ name, contents }`, where `name` is
   * the path RELATIVE to the bundle directory (POSIX separators — it becomes a
   * repo path under `.devdigest/runner/`).
   *
   * Throws `ConfigError` naming both the artifact and the build command when the
   * directory is absent or empty (AC-8). It never returns an empty array: an
   * empty bundle and a missing one are the same broken export.
   */
  read(): Promise<RunnerFile[]>;
}

/** The message AC-8 pins: it must name the artifact AND the command that builds it. */
export function runnerBundleMissingMessage(dir: string): string {
  return (
    `The CI runner bundle is missing: no files found in ${dir} (agent-runner/dist). ` +
    'Build it first with `cd agent-runner && pnpm build`, then export again. ' +
    'Nothing was committed and no CI installation was created.'
  );
}

/** Reads the bundle from a directory on disk. Constructed with `config.ciRunnerDir`. */
export class FsRunnerBundleReader implements RunnerBundleReader {
  constructor(private readonly dir: string) {}

  async read(): Promise<RunnerFile[]> {
    let names: string[];
    try {
      names = await walk(this.dir);
    } catch (err) {
      // ENOENT / EACCES / not-a-directory all mean the same thing to the caller.
      throw new ConfigError(runnerBundleMissingMessage(this.dir), {
        cause: (err as Error).message,
      });
    }
    if (names.length === 0) throw new ConfigError(runnerBundleMissingMessage(this.dir));

    // Sorted so the committed file order is a pure function of the build output
    // (AC-13): `readdir` order is filesystem-dependent and is NOT stable.
    names.sort();
    return Promise.all(
      names.map(async (name) => ({
        name,
        contents: await readFile(join(this.dir, ...name.split('/')), 'utf8'),
      })),
    );
  }
}

/** Relative POSIX paths of every regular file under `dir`, recursively. */
async function walk(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await walk(join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}
