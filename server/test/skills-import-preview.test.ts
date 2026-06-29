import { describe, it, expect } from 'vitest';
import { SkillsService } from '../src/modules/skills/service.js';

/**
 * Hermetic unit: the markdown preview parser is pure (no DB, no container).
 * The container is unused by previewMarkdown so we cast a dummy.
 */
function makeService(): SkillsService {
  return new SkillsService({} as never);
}

describe('SkillsService.previewMarkdown', () => {
  it('uses frontmatter when present', () => {
    const svc = makeService();
    const md = `---
name: phantom-api-gate
description: Flags routes that respond before persistence.
type: security
---

# Phantom API Gate

Body content here.
`;
    const p = svc.previewMarkdown('skill.md', md);
    expect(p.name).toBe('phantom-api-gate');
    expect(p.description).toBe('Flags routes that respond before persistence.');
    expect(p.type).toBe('security');
    expect(p.body.startsWith('# Phantom API Gate')).toBe(true);
    expect(p.warnings).toEqual([]);
  });

  it('falls back to first heading + paragraph when frontmatter is missing', () => {
    const svc = makeService();
    const md = `# Untyped Skill

This skill checks something useful.

## Details
Stuff.
`;
    const p = svc.previewMarkdown('untyped.md', md);
    expect(p.name).toBe('Untyped Skill');
    expect(p.description).toBe('This skill checks something useful.');
    expect(p.type).toBe('custom');
  });

  it('defaults type to custom and warns on unknown frontmatter type', () => {
    const svc = makeService();
    const md = `---
name: weird
type: rubrik
---
body
`;
    const p = svc.previewMarkdown('weird.md', md);
    expect(p.type).toBe('custom');
    expect(p.warnings.some((w) => w.includes('rubrik'))).toBe(true);
  });

  it('uses filename as fallback name when nothing else is available', () => {
    const svc = makeService();
    const p = svc.previewMarkdown('my-rule.md', 'no headings\n\nfree text only');
    expect(p.name).toBe('my-rule');
  });
});
