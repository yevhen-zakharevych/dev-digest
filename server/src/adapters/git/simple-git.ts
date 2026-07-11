import { simpleGit, type SimpleGit } from 'simple-git';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { mkdir, readFile, readdir, realpath, access, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import type {
  GitClient,
  RepoRef,
  CloneOptions,
  UnifiedDiff,
  BlameLine,
  GitCommit,
  RepoFileEntry,
} from '@devdigest/shared';
import { parseUnifiedDiff } from './diff-parser.js';

/**
 * Depth fetched by `sync()`. Deeper than the shallow clone (CLONE_DEPTH=1) so the
 * previously-indexed sha is usually reachable, keeping the resync diff incremental;
 * when it isn't, the indexer falls back to a full reindex.
 */
const RESYNC_FETCH_DEPTH = 50;

/**
 * GitClient over simple-git. Repos clone to
 * `<cloneDir>/<owner>/<repo>`. We NEVER execute repo code — only git ops.
 */
export class SimpleGitClient implements GitClient {
  constructor(private cloneDir: string) {
    // Force non-interactive auth so an unauthenticated/private clone fails in
    // ~1s with a clear error instead of hanging on a credential prompt until the
    // job timeout. Set on process.env (inherited by git subprocesses) rather
    // than via simple-git's .env(), which inspects and rejects vars like
    // PAGER/EDITOR present in the shell environment.
    process.env.GIT_TERMINAL_PROMPT ??= '0';
    process.env.GCM_INTERACTIVE ??= 'never';
  }

  clonePathFor(repo: RepoRef): string {
    return join(this.cloneDir, repo.owner, repo.name);
  }

  private git(repo: RepoRef): SimpleGit {
    return simpleGit(this.clonePathFor(repo));
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }> {
    const dest = this.clonePathFor(repo);
    await mkdir(join(this.cloneDir, repo.owner), { recursive: true });
    if (await this.exists(join(dest, '.git'))) {
      // already cloned → fetch latest
      await simpleGit(dest).fetch();
      return { path: dest };
    }
    // A prior clone may have timed out mid-write, leaving a partial dir without
    // a .git — git clone refuses a non-empty dest, so clear it first.
    if (await this.exists(dest)) await rm(dest, { recursive: true, force: true });
    const args: string[] = [];
    if (opts?.depth) args.push('--depth', String(opts.depth));
    if (opts?.branch) args.push('--branch', opts.branch);
    await simpleGit(this.cloneDir).clone(url, dest, args);
    return { path: dest };
  }

  async fetchPullHead(repo: RepoRef, n: number): Promise<void> {
    // Fetch the PR head ref into a local ref (GitHub exposes pull/<n>/head).
    await this.git(repo).fetch(['origin', `pull/${n}/head:pr-${n}`]);
  }

  async sync(repo: RepoRef, branch: string): Promise<{ head: string }> {
    // Resync the read-only mirror to upstream. A bare `fetch` only moves
    // `origin/<branch>`, so we `reset --hard` to advance local HEAD + worktree —
    // safe here because we never commit to or run code from the clone.
    // Fetch a bounded depth (> the shallow CLONE_DEPTH) so the prior indexed sha
    // is usually reachable for an incremental diff; the indexer falls back to a
    // full reindex when it isn't.
    const g = this.git(repo);
    await g.fetch(['origin', branch, '--depth', String(RESYNC_FETCH_DEPTH)]);
    await g.reset(['--hard', `origin/${branch}`]);
    return { head: (await g.revparse(['HEAD'])).trim() };
  }

  async currentHead(repo: RepoRef): Promise<string> {
    return (await this.git(repo).revparse(['HEAD'])).trim();
  }

  async diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff> {
    const raw = await this.git(repo).diff([`${base}...${head}`]);
    return parseUnifiedDiff(raw);
  }

  /**
   * `git diff --name-only base..head` — used by the incremental indexer to
   * pick the file set that changed since `last_indexed_sha`. Two-dot is
   * intentional (commits reachable from `head` but not `base`), unlike the
   * three-dot symmetric form `diff()` uses for review diffs.
   */
  async diffNameOnly(repo: RepoRef, base: string, head: string): Promise<string[]> {
    if (base === head) return [];
    const raw = await this.git(repo).raw(['diff', '--name-only', `${base}..${head}`]);
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async blame(repo: RepoRef, path: string): Promise<BlameLine[]> {
    const raw = await this.git(repo).raw(['blame', '--line-porcelain', path]);
    return parseBlamePorcelain(raw);
  }

  async log(repo: RepoRef, path?: string): Promise<GitCommit[]> {
    const log = await this.git(repo).log(path ? { file: path } : undefined);
    return log.all.map((c) => ({
      sha: c.hash,
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
  }

  async readFile(repo: RepoRef, path: string): Promise<string> {
    return readFile(join(this.clonePathFor(repo), path), 'utf8');
  }

  /**
   * Sandboxed read (port contract in `@devdigest/shared`'s `GitClient`).
   * `relPath` is treated as ATTACKER-CONTROLLED (PR-body-derived plan/spec
   * references, LLM-suggested evidence paths) — reject `..`-escapes and
   * symlink escapes rather than trusting a caller-side shape check. Never
   * throws; returns `null` for any unsafe/missing/unreadable path.
   */
  async readFileSafe(repo: RepoRef, relPath: string): Promise<string | null> {
    const cloneRoot = this.clonePathFor(repo);
    const abs = await this.safeResolve(cloneRoot, relPath);
    if (!abs) return null;
    try {
      return await readFile(abs, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Sandboxed write into the clone's WORKING TREE, guarded by the same
   * `safeResolve` used for reads: `..`-escapes, absolute paths, NUL bytes and
   * out-of-tree symlinks are refused. Because `safeResolve` calls `realpath`,
   * this only ever overwrites an EXISTING file — creating new files is out of
   * scope, and a vanished path returns `false` rather than resurrecting it.
   *
   * Deliberately performs NO git operation. The write lives in the working
   * tree only, so `sync()`'s `git reset --hard` discards it for a tracked file.
   * Never throws; returns `false` on any unsafe or failed write.
   */
  async writeFileSafe(repo: RepoRef, relPath: string, text: string): Promise<boolean> {
    const cloneRoot = this.clonePathFor(repo);
    const abs = await this.safeResolve(cloneRoot, relPath);
    if (!abs) return false;
    try {
      await writeFile(abs, text, 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Walk the clone's working tree for `*.md` files, returning repo-relative
   * POSIX paths and byte sizes. File CONTENTS are never read — the byte size
   * is what a caller turns into a token estimate, keeping discovery cheap.
   *
   * Symlinks (file OR directory) are skipped outright rather than resolved:
   * that is strictly stronger than checking where they point, and it removes
   * any chance of escaping the clone or looping. `.git` is skipped.
   * Returns `null` when the clone directory does not exist.
   */
  async listMarkdownFilesSafe(repo: RepoRef): Promise<RepoFileEntry[] | null> {
    const rawRoot = this.clonePathFor(repo);
    if (!(await this.exists(rawRoot))) return null;
    // Resolve any symlinked ancestor (e.g. macOS `/tmp` -> `/private/tmp`) ONCE,
    // so the walk root + every returned repo-relative path are computed
    // against the SAME canonical root `safeResolve` compares against below.
    // Without this, a symlinked ancestor makes discovery list documents that
    // `readFileSafe`/`writeFileSafe` then refuse for every one of them (AC-1
    // vs AC-30) — `realpath` never fails here since `exists()` above already
    // confirmed the raw path resolves, but fall back defensively regardless.
    const cloneRoot = await realpath(rawRoot).catch(() => rawRoot);

    const out: RepoFileEntry[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // unreadable subtree — skip, don't fail the whole walk
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '.git') continue;
          await walk(abs);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          try {
            const { size } = await stat(abs);
            out.push({ path: relative(cloneRoot, abs).split(sep).join(posix.sep), bytes: size });
          } catch {
            // vanished between readdir and stat — skip
          }
        }
      }
    };
    await walk(cloneRoot);
    return out;
  }

  /**
   * Resolve `rel` against `cloneRoot`, refusing anything that escapes it via
   * `..` traversal or a symlink pointing outside the clone. Returns the
   * resolved absolute path, or `null` when unsafe / non-existent.
   */
  private async safeResolve(cloneRoot: string, rel: string): Promise<string | null> {
    if (!rel || isAbsolute(rel) || rel.includes('\0')) return null;
    const target = resolve(cloneRoot, rel);
    const rootWithSep = cloneRoot.endsWith(sep) ? cloneRoot : cloneRoot + sep;
    // Cheap, filesystem-free reject: does the resolved string even start with
    // the raw root? This catches an obvious `..`-escape before we touch disk.
    if (target !== cloneRoot && !target.startsWith(rootWithSep)) return null;
    try {
      // Realpath BOTH the target AND the root before the real containment
      // check (FIX 3). Comparing a realpath'd target against a non-realpath'd
      // root always mismatches when any ancestor of `cloneRoot` is a symlink
      // (macOS `/tmp` -> `/private/tmp`), refusing every otherwise-valid
      // in-tree path — this is what made discovery list documents that this
      // same guard then rejected. Realpathing both sides keeps the guard just
      // as strict against a genuine out-of-tree symlink escape.
      const [real, realRoot] = await Promise.all([realpath(target), realpath(cloneRoot)]);
      const realRootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
      if (real !== realRoot && !real.startsWith(realRootWithSep)) return null;
      return real;
    } catch {
      return null;
    }
  }
}

function parseBlamePorcelain(raw: string): BlameLine[] {
  const out: BlameLine[] = [];
  const lines = raw.split('\n');
  let sha = '';
  let author = '';
  let date = '';
  let summary = '';
  let lineNo = 0;
  for (const line of lines) {
    const header = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (header) {
      sha = header[1]!;
      lineNo = Number(header[2]);
    } else if (line.startsWith('author ')) author = line.slice(7);
    else if (line.startsWith('author-time '))
      date = new Date(Number(line.slice(12)) * 1000).toISOString();
    else if (line.startsWith('summary ')) summary = line.slice(8);
    else if (line.startsWith('\t')) {
      out.push({ line: lineNo, sha, author, date, summary });
    }
  }
  return out;
}
