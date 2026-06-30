import type { Container } from '../../platform/container.js';
import type { Skill, SkillDetailStats, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import { SkillsRepository, type SkillRow } from './repository.js';
import type { SkillVersionRow } from '../../db/rows.js';

/**
 * L02 — skills service. CRUD + import preview/save.
 *
 * Skills are PLAIN TEXT instructions appended into the agent's prompt. The
 * import path NEVER runs / extracts executable content: a zip archive is
 * scanned, only `SKILL.md` (or the first top-level `.md`) is read; every other
 * file (scripts, references, etc.) is listed in `skippedFiles` and shown in the
 * preview, but its bytes never leave the request boundary.
 */

export function toSkillDto(row: SkillRow, agentsCount = 0): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    agents_count: agentsCount,
  };
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
  /**
   * Optional list of repo-relative paths that informed the body. The Conventions
   * Extractor sets this when merging accepted candidates into one skill; the
   * manual create form leaves it undefined.
   */
  evidenceFiles?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

/**
 * Result of an import preview — the user confirms before anything is written.
 * `skippedFiles` is informational only (executable / non-markdown bits are
 * never read or persisted).
 */
export interface ImportPreview {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  skippedFiles: string[];
  warnings: string[];
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    const stats = await this.repo.statsFor(rows.map((r) => r.id));
    return rows.map((r) => toSkillDto(r, stats.get(r.id)?.agentsCount ?? 0));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    const stats = await this.repo.statsFor([row.id]);
    return toSkillDto(row, stats.get(row.id)?.agentsCount ?? 0);
  }

  /** Version history (newest-first). Returns undefined when the skill is not in
   *  this workspace, so the route maps that to 404 without cross-tenant leaks. */
  async listVersions(
    workspaceId: string,
    skillId: string,
  ): Promise<SkillVersion[] | undefined> {
    const row = await this.repo.getById(workspaceId, skillId);
    if (!row) return undefined;
    const versions = await this.repo.listVersions(skillId);
    return versions.map(toSkillVersionDto);
  }

  async create(
    workspaceId: string,
    input: CreateSkillInput,
    source: SkillSource = 'manual',
  ): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source,
      body: input.body,
      enabled: input.enabled,
      ...(input.evidenceFiles ? { evidenceFiles: input.evidenceFiles } : {}),
    });
    // Newly created → no agents linked yet → count is 0.
    return toSkillDto(row, 0);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    if (!row) return undefined;
    const stats = await this.repo.statsFor([row.id]);
    return toSkillDto(row, stats.get(row.id)?.agentsCount ?? 0);
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async restore(workspaceId: string, id: string, version: number): Promise<Skill | undefined> {
    const snapshot = await this.repo.getVersion(id, version);
    if (!snapshot) return undefined;
    return this.update(workspaceId, id, { body: snapshot.body });
  }

  async getStats(workspaceId: string, id: string): Promise<SkillDetailStats | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;

    const { agents, findingsTotal, findingsAccepted, findingsByCategory } =
      await this.repo.detailStatsFor(workspaceId, id);

    const accept_rate =
      findingsTotal > 0 ? Math.round((findingsAccepted / findingsTotal) * 100) / 100 : null;

    return {
      used_by: agents.length,
      pull_frequency: null,
      accept_rate,
      findings_30d: findingsTotal,
      agents,
      findings_by_category: findingsByCategory,
    };
  }

  // ---- Import ---------------------------------------------------------------

  /**
   * Parse a markdown file. Frontmatter (YAML between `---` fences) provides
   * name/description/type when present; otherwise we infer name from the first
   * `#` heading and description from the first non-empty paragraph. Body is
   * everything after the frontmatter (or the whole text if there's none).
   */
  previewMarkdown(filename: string, content: string): ImportPreview {
    const parsed = parseFrontmatter(content);
    const fallbackName = stripExt(filename);
    const inferredHeading = firstHeading(parsed.body);
    const inferredParagraph = firstParagraph(parsed.body);
    const fm = parsed.frontmatter;

    const type = isSkillType(fm.type) ? fm.type : 'custom';
    const warnings: string[] = [];
    if (fm.type && !isSkillType(fm.type)) {
      warnings.push(`Unknown type "${fm.type}" in frontmatter — defaulted to "custom"`);
    }

    return {
      name: (fm.name as string | undefined) ?? inferredHeading ?? fallbackName,
      description: (fm.description as string | undefined) ?? inferredParagraph ?? '',
      type,
      body: parsed.body.trim(),
      skippedFiles: [],
      warnings,
    };
  }

  /**
   * Parse a zip archive. Only the entry named `SKILL.md` (case-insensitive) is
   * read; if absent, the first `.md` entry at the archive root. Every other
   * entry is recorded in `skippedFiles` so the user can see what was ignored —
   * its bytes are NOT extracted.
   */
  async previewZip(buffer: Buffer): Promise<ImportPreview> {
    const { default: AdmZip } = await import('adm-zip');
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    let chosen: { name: string; content: string } | undefined;
    const skipped: string[] = [];
    let skillMd: { name: string; content: string } | undefined;
    let firstMd: { name: string; content: string } | undefined;

    for (const e of entries) {
      if (e.isDirectory) continue;
      const base = e.entryName.split('/').pop()!;
      const lower = base.toLowerCase();
      const isMd = lower.endsWith('.md');
      if (lower === 'skill.md' && !skillMd) {
        skillMd = { name: e.entryName, content: e.getData().toString('utf8') };
        continue;
      }
      if (isMd && !firstMd) {
        firstMd = { name: e.entryName, content: e.getData().toString('utf8') };
        continue;
      }
      skipped.push(e.entryName);
    }

    chosen = skillMd ?? firstMd;
    if (!chosen) {
      return {
        name: '',
        description: '',
        type: 'custom',
        body: '',
        skippedFiles: skipped,
        warnings: ['No SKILL.md or markdown file found in archive'],
      };
    }

    const preview = this.previewMarkdown(chosen.name, chosen.content);
    return {
      ...preview,
      skippedFiles: skipped,
      warnings: [
        ...preview.warnings,
        ...(skipped.length > 0
          ? [`${skipped.length} non-markdown file(s) were ignored (not executed or stored)`]
          : []),
      ],
    };
  }

  /** Persist an imported preview. Source is set to `imported_url`. */
  async createFromImport(workspaceId: string, preview: ImportPreview): Promise<Skill> {
    return this.create(
      workspaceId,
      {
        name: preview.name,
        description: preview.description,
        type: preview.type,
        body: preview.body,
      },
      'imported_url',
    );
  }
}

// ---- Markdown helpers (no external deps) -----------------------------------

function isSkillType(v: unknown): v is SkillType {
  return v === 'rubric' || v === 'convention' || v === 'security' || v === 'custom';
}

function stripExt(name: string): string {
  return name.replace(/\.[^/.]+$/, '').replace(/^.*\//, '');
}

interface ParsedMd {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Minimal YAML-frontmatter parser. We only consume scalar keys (name,
 * description, type) so a hand-rolled `key: value` parser is enough; we
 * deliberately do NOT pull in a YAML lib for skill imports.
 */
function parseFrontmatter(content: string): ParsedMd {
  const trimmed = content.replace(/^﻿/, '');
  if (!trimmed.startsWith('---')) return { frontmatter: {}, body: trimmed };
  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: trimmed };
  const fmText = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '');
  const fm: Record<string, unknown> = {};
  for (const line of fmText.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = rawValue!.replace(/^["']|["']$/g, '');
    fm[key!] = value;
  }
  return { frontmatter: fm, body };
}

function firstHeading(body: string): string | undefined {
  const m = body.match(/^#+\s+(.+)$/m);
  return m ? m[1]!.trim() : undefined;
}

function firstParagraph(body: string): string | undefined {
  const lines = body.split(/\r?\n/);
  const para: string[] = [];
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    if (line.trim().length === 0) {
      if (para.length > 0) break;
      continue;
    }
    para.push(line.trim());
  }
  return para.length > 0 ? para.join(' ') : undefined;
}
