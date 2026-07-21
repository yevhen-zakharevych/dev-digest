import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { MAX_ARTIFACT_BYTES } from '../src/adapters/github/octokit.js';

/**
 * Regression guard for the CI-artifact ZIP read (`downloadRunResultArtifact`).
 *
 * The artifact is produced in a THIRD-PARTY repository's CI, so its bytes are
 * attacker-influenced. The two size checks that bound the *compressed* archive are not
 * enough: `adm-zip` allocates the output buffer from the size the archive DECLARES for an
 * entry, before inflating anything (`zipEntry.js:103`), and uses that same declared value
 * as the inflate ceiling (`methods/inflater.js:5`). A tiny archive that lies about its
 * uncompressed size therefore costs real memory.
 *
 * Measured on this tree before the guard existed: a 181-byte archive declaring 1.5 GB
 * allocated ~1.4 GB of RSS and blocked the event loop for ~4 s before failing its CRC
 * check. `withTimeout` cannot interrupt that (the allocation and inflate are synchronous),
 * and a larger declaration OOM-kills the process instead — which no `catch` can rescue.
 *
 * These tests deliberately never call `getData()` on the hostile archive: doing so is the
 * very thing the guard exists to prevent, and it would make the suite allocate gigabytes.
 */

const RESULT_ENTRY = 'devdigest-result.json';

/** A valid archive whose declared uncompressed size is a lie. */
function zipDeclaringSize(declared: number): Buffer {
  const zip = new AdmZip();
  zip.addFile(RESULT_ENTRY, Buffer.from('{"findings_count":0,"cost_usd":0,"agent":"x"}'));
  const buf = Buffer.from(zip.toBuffer());

  // Overwrite the uncompressed-size field in both the local file header (offset +22 from
  // its signature) and the central directory entry (+24) — the two places a reader can
  // take the value from.
  for (let i = 0; i < buf.length - 4; i++) {
    const sig = buf.readUInt32LE(i);
    if (sig === 0x04034b50) buf.writeUInt32LE(declared, i + 22);
    if (sig === 0x02014b50) buf.writeUInt32LE(declared, i + 24);
  }
  return buf;
}

describe('CI artifact ZIP — decompressed-size guard', () => {
  it('a tiny archive can declare a huge uncompressed size, and the declared value is what we must check', () => {
    const bomb = zipDeclaringSize(1_500_000_000);
    const entry = new AdmZip(bomb).getEntry(RESULT_ENTRY);

    // The archive itself is trivially small — so neither compressed-size check can see it.
    expect(bomb.byteLength).toBeLessThan(1024);
    expect(bomb.byteLength).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);

    // …while the number that actually drives adm-zip's allocation is enormous.
    expect(entry?.header.size).toBe(1_500_000_000);
    expect(entry!.header.size).toBeGreaterThan(MAX_ARTIFACT_BYTES);
  });

  it('an honest artifact of a normal size passes the same guard', () => {
    const zip = new AdmZip();
    const payload = '{"findings_count":3,"cost_usd":0.04,"agent":"Security Reviewer"}';
    zip.addFile(RESULT_ENTRY, Buffer.from(payload));
    const entry = new AdmZip(Buffer.from(zip.toBuffer())).getEntry(RESULT_ENTRY);

    expect(entry?.header.size).toBe(Buffer.byteLength(payload));
    expect(entry!.header.size).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);
    // Safe to decompress only because the guard passed — this is the ordering the adapter
    // enforces, and the reason this assertion comes last.
    expect(entry!.getData().toString('utf8')).toBe(payload);
  });
});
