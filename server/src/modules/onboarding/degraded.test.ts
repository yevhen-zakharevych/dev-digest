import { describe, it, expect } from 'vitest';
import { degradedReasonFor } from './service.js';
import type { IndexState } from '../repo-intel/types.js';
import type { AppConfig } from '../../platform/config.js';

/**
 * AC-12 — the index-state → closed-reason-code mapping (plan §3), derived from
 * the repo-intel `DegradedReason` vocabulary, not invented. Pure + hermetic.
 */

function state(over: Partial<IndexState>): IndexState {
  return {
    repoId: 'r',
    status: 'full',
    filesIndexed: 3,
    filesSkipped: 0,
    durationMs: 0,
    lastIndexedSha: 'sha1',
    indexerVersion: 1,
    updatedAt: new Date(),
    ...over,
  };
}

const on = { repoIntelEnabled: true } as AppConfig;
const off = { repoIntelEnabled: false } as AppConfig;

describe('degradedReasonFor — reason-code mapping (AC-11/12)', () => {
  it('returns null (proceed) for a present, full index', () => {
    expect(degradedReasonFor(state({ status: 'full', lastIndexedSha: 'sha1' }), on)).toBeNull();
  });

  it('flag_off when REPO_INTEL_ENABLED is off', () => {
    expect(degradedReasonFor(state({ status: 'full' }), off)).toBe('flag_off');
  });

  it('index_partial for a partial index', () => {
    expect(degradedReasonFor(state({ status: 'partial' }), on)).toBe('index_partial');
  });

  it('index_failed for a failed index', () => {
    expect(degradedReasonFor(state({ status: 'failed' }), on)).toBe('index_failed');
  });

  it('no_data for a synthesized-degraded (un-indexed) repo', () => {
    expect(
      degradedReasonFor(
        state({ status: 'degraded', degraded: true, degradedReason: 'no_data', lastIndexedSha: '' }),
        on,
      ),
    ).toBe('no_data');
  });

  it('repo_too_large when the index recorded that reason', () => {
    expect(
      degradedReasonFor(state({ status: 'degraded', degradedReason: 'repo_too_large' }), on),
    ).toBe('repo_too_large');
  });

  it('no_data for a full status with an empty SHA', () => {
    expect(degradedReasonFor(state({ status: 'full', lastIndexedSha: '' }), on)).toBe('no_data');
  });
});
