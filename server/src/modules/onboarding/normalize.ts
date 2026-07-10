/**
 * L05 — Onboarding section normalizer (PURE — no I/O).
 *
 * Turns the model's raw sections into the canonical five-in-order set:
 *   - restrict `kind` to the fixed vocabulary; drop unknown/duplicate; never
 *     reorder (AC-1, AC-2)
 *   - keep a mermaid `diagram` only for `architecture`, and only when it passes
 *     the validity heuristic; force every other section's diagram to null; drop
 *     an invalid `architecture` diagram while keeping its prose (AC-3)
 *   - drop any link whose path is not present in the real repo path set (AC-4)
 *   - reorder the `reading_path` links to descending file rank (AC-6)
 *
 * All rules are deterministic and hermetic; the service supplies the valid path
 * set (git tree ∪ index) and the rank order as plain data.
 */
import type { OnboardingLink, OnboardingSection } from '@devdigest/shared';
import {
  DIAGRAM_ELIGIBLE_KIND,
  MERMAID_HEADERS,
  ONBOARDING_SECTION_KINDS,
  type OnboardingSectionKind,
} from './constants.js';

export interface NormalizeContext {
  /** Real repo paths (git tree ∪ indexed set); links outside it are dropped. */
  validPaths: Set<string>;
  /** Reading-path files in descending rank order (AC-6). */
  readingPathOrder: string[];
}

function isKnownKind(kind: string): kind is OnboardingSectionKind {
  return (ONBOARDING_SECTION_KINDS as readonly string[]).includes(kind);
}

/**
 * A diagram is kept only when it is non-empty, carries no ``` fences, and
 * starts with a known mermaid header (N1 / AC-3). Otherwise it is dropped and
 * the section keeps its prose.
 */
export function isValidMermaid(diagram: string | null | undefined): boolean {
  if (!diagram) return false;
  if (diagram.includes('```')) return false;
  const firstLine = diagram.trimStart().split(/\r?\n/, 1)[0]?.trimStart() ?? '';
  return MERMAID_HEADERS.some((h) => firstLine.startsWith(h));
}

function normalizeLinks(
  kind: OnboardingSectionKind,
  links: OnboardingLink[],
  ctx: NormalizeContext,
): OnboardingLink[] {
  // Drop invented paths (AC-4): keep only links resolving to a real repo path.
  const grounded = links.filter((l) => ctx.validPaths.has(l.path));
  if (kind !== 'reading_path') return dedupeByPath(grounded);

  // Reading path: order by descending file rank (AC-6). Links not in the rank
  // order are not rank-grounded, so they are dropped.
  const rankIndex = new Map(ctx.readingPathOrder.map((p, i) => [p, i]));
  return dedupeByPath(grounded)
    .filter((l) => rankIndex.has(l.path))
    .sort((a, b) => (rankIndex.get(a.path) ?? 0) - (rankIndex.get(b.path) ?? 0));
}

function dedupeByPath(links: OnboardingLink[]): OnboardingLink[] {
  const seen = new Set<string>();
  const out: OnboardingLink[] = [];
  for (const l of links) {
    if (seen.has(l.path)) continue;
    seen.add(l.path);
    out.push(l);
  }
  return out;
}

/**
 * Normalize the model's raw sections to the canonical five-in-order set. Only
 * kinds the model produced are included (never fabricated); unknown/duplicate
 * kinds are dropped and the order is fixed regardless of the model's order.
 */
export function normalizeSections(
  raw: OnboardingSection[],
  ctx: NormalizeContext,
): OnboardingSection[] {
  // First occurrence of each known kind wins (drop duplicates, AC-2).
  const firstByKind = new Map<OnboardingSectionKind, OnboardingSection>();
  for (const s of raw) {
    if (!isKnownKind(s.kind)) continue;
    if (!firstByKind.has(s.kind)) firstByKind.set(s.kind, s);
  }

  const out: OnboardingSection[] = [];
  for (const kind of ONBOARDING_SECTION_KINDS) {
    const s = firstByKind.get(kind);
    if (!s) continue;
    const keepDiagram = kind === DIAGRAM_ELIGIBLE_KIND && isValidMermaid(s.diagram);
    out.push({
      kind,
      title: s.title,
      body: s.body,
      diagram: keepDiagram ? s.diagram : null,
      links: normalizeLinks(kind, s.links, ctx),
    });
  }
  return out;
}
