import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

/**
 * Guards the MCP-client-timeout landmine: `run_agent_on_pr` blocks up to
 * `maxWaitMs`, but the MCP client aborts a request after ~60 s, so `maxWaitMs`
 * must never reach that ceiling.
 */

const saved = { url: process.env.DEVDIGEST_API_URL, wait: process.env.MAX_WAIT_MS };

afterEach(() => {
  process.env.DEVDIGEST_API_URL = saved.url;
  process.env.MAX_WAIT_MS = saved.wait;
});

describe('loadConfig', () => {
  it('defaults apiUrl and strips a trailing slash', () => {
    delete process.env.DEVDIGEST_API_URL;
    expect(loadConfig().apiUrl).toBe('http://localhost:3001');
    process.env.DEVDIGEST_API_URL = 'http://example.test/';
    expect(loadConfig().apiUrl).toBe('http://example.test');
  });

  it('defaults maxWaitMs under the 60s client request timeout', () => {
    delete process.env.MAX_WAIT_MS;
    expect(loadConfig().maxWaitMs).toBeLessThan(60000);
  });

  it('clamps an oversized MAX_WAIT_MS down under the client timeout', () => {
    process.env.MAX_WAIT_MS = '180000';
    expect(loadConfig().maxWaitMs).toBeLessThan(60000);
  });

  it('honours a smaller MAX_WAIT_MS as-is', () => {
    process.env.MAX_WAIT_MS = '10000';
    expect(loadConfig().maxWaitMs).toBe(10000);
  });

  it('falls back to the default for a non-numeric MAX_WAIT_MS', () => {
    process.env.MAX_WAIT_MS = 'not-a-number';
    expect(loadConfig().maxWaitMs).toBeLessThan(60000);
    expect(loadConfig().maxWaitMs).toBeGreaterThan(0);
  });
});
