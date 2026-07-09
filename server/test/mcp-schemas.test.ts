import { describe, it, expect } from 'vitest';
import {
  ListAgentsInput,
  RunAgentOnPrInput,
  GetFindingsInput,
  GetConventionsInput,
  GetBlastRadiusInput,
} from '../src/mcp/schemas.js';

/**
 * Hermetic pure-Zod coverage for the MCP tool input schemas
 * (`docs/plans/L04-devdigest-mcp.md` §5/§5.1, task W0-SCHEMAS). No I/O.
 */

describe('ListAgentsInput', () => {
  it('accepts an empty object', () => {
    expect(ListAgentsInput.safeParse({}).success).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(ListAgentsInput.safeParse({ foo: 'bar' }).success).toBe(false);
  });
});

describe('RunAgentOnPrInput', () => {
  const valid = { repo: 'acme/web', pr: 42, agent: 'agent-1' };

  it('accepts valid flat input', () => {
    const result = RunAgentOnPrInput.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(valid);
  });

  it('rejects unknown top-level keys', () => {
    expect(RunAgentOnPrInput.safeParse({ ...valid, extra: 'nope' }).success).toBe(false);
  });

  it('rejects a nested object in place of a flat field', () => {
    expect(
      RunAgentOnPrInput.safeParse({ repo: { owner: 'acme', name: 'web' }, pr: 42, agent: 'a' })
        .success,
    ).toBe(false);
  });

  it('rejects a non-integer pr', () => {
    expect(RunAgentOnPrInput.safeParse({ ...valid, pr: 4.2 }).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(RunAgentOnPrInput.safeParse({ repo: 'acme/web' }).success).toBe(false);
  });
});

describe('GetFindingsInput', () => {
  const RUN_ID = '11111111-1111-4111-8111-111111111111';

  it('accepts run_id alone', () => {
    const result = GetFindingsInput.safeParse({ run_id: RUN_ID });
    expect(result.success).toBe(true);
  });

  it('accepts repo+pr together', () => {
    const result = GetFindingsInput.safeParse({ repo: 'acme/web', pr: 7 });
    expect(result.success).toBe(true);
  });

  it('rejects both run_id AND repo+pr provided', () => {
    const result = GetFindingsInput.safeParse({ run_id: RUN_ID, repo: 'acme/web', pr: 7 });
    expect(result.success).toBe(false);
  });

  it('rejects neither run_id nor repo+pr provided', () => {
    const result = GetFindingsInput.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a lone repo without pr (partial combo counts as neither)', () => {
    const result = GetFindingsInput.safeParse({ repo: 'acme/web' });
    expect(result.success).toBe(false);
  });

  it('rejects a lone pr without repo (partial combo counts as neither)', () => {
    const result = GetFindingsInput.safeParse({ pr: 7 });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid (non-uuid) run_id', () => {
    expect(GetFindingsInput.safeParse({ run_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(GetFindingsInput.safeParse({ run_id: RUN_ID, extra: true }).success).toBe(false);
  });

  it('rejects a nested object field', () => {
    expect(GetFindingsInput.safeParse({ repo: { owner: 'acme' }, pr: 7 }).success).toBe(false);
  });

  it('defaults format to concise and offset to 0', () => {
    const result = GetFindingsInput.safeParse({ run_id: RUN_ID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe('concise');
      expect(result.data.offset).toBe(0);
    }
  });

  it('accepts an explicit format and offset', () => {
    const result = GetFindingsInput.safeParse({ run_id: RUN_ID, format: 'detailed', offset: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe('detailed');
      expect(result.data.offset).toBe(5);
    }
  });

  it('rejects an unknown format value', () => {
    expect(GetFindingsInput.safeParse({ run_id: RUN_ID, format: 'verbose' }).success).toBe(false);
  });

  it('rejects a negative offset', () => {
    expect(GetFindingsInput.safeParse({ run_id: RUN_ID, offset: -1 }).success).toBe(false);
  });
});

describe('GetConventionsInput', () => {
  it('accepts valid flat input', () => {
    expect(GetConventionsInput.safeParse({ repo: 'acme/web' }).success).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(GetConventionsInput.safeParse({ repo: 'acme/web', extra: 1 }).success).toBe(false);
  });

  it('rejects a nested object', () => {
    expect(GetConventionsInput.safeParse({ repo: { owner: 'acme', name: 'web' } }).success).toBe(
      false,
    );
  });

  it('rejects missing repo', () => {
    expect(GetConventionsInput.safeParse({}).success).toBe(false);
  });
});

describe('GetBlastRadiusInput', () => {
  it('accepts valid flat input', () => {
    expect(GetBlastRadiusInput.safeParse({ repo: 'acme/web', pr: 3 }).success).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(GetBlastRadiusInput.safeParse({ repo: 'acme/web', pr: 3, extra: 1 }).success).toBe(
      false,
    );
  });

  it('rejects a nested object', () => {
    expect(GetBlastRadiusInput.safeParse({ repo: { owner: 'acme' }, pr: 3 }).success).toBe(false);
  });

  it('rejects a non-integer pr', () => {
    expect(GetBlastRadiusInput.safeParse({ repo: 'acme/web', pr: 3.5 }).success).toBe(false);
  });
});
