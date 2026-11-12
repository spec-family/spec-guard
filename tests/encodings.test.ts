/**
 * A spec written in UTF-16.
 *
 * Windows PowerShell 5.1 writes UTF-16LE, with a byte order mark, for `>` and
 * `Out-File`. Read as UTF-8, such a spec held no directive and the run said
 * "1 spec - 0 assertions" and nothing else (round 29). A byte order mark now
 * says how to read it; a file with NUL bytes and no mark, which no UTF-8 text
 * holds, is warned of on its first line.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { findClaimsReport } from '../src/claims.js';
import { formatGithub, formatJson, formatReport, runAnnotations } from '../src/reporter.js';
import { runSpecGuard } from '../src/runner.js';
import { decodeDocument } from '../src/specs.js';
import { memoryIo } from './helpers.js';

const ROOT = path.resolve('/virtual/encodings');
const SPEC = '# ADR\n\nNo legacy client.\n<!-- @assert-absence symbol="LegacyClient" target="src" -->\n';

const utf16le = (text: string, mark = true): Buffer => Buffer.concat([mark ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(text, 'utf16le')]);
const utf16be = (text: string): Buffer => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);

async function run(spec: Buffer | string, code = 'export const ok = 1;\n') {
  return runSpecGuard({ patterns: ['docs/adr.md'], root: ROOT, io: memoryIo(ROOT, { 'docs/adr.md': spec, 'src/a.ts': code }), engine: 'javascript' });
}

describe('a spec in UTF-16 with a byte order mark', () => {
  it('is read, little-endian as PowerShell writes it, and its rule runs and fails', async () => {
    const report = await run(utf16le(SPEC), 'new LegacyClient();\n');

    expect(report.summary.total).toBe(1);
    expect(report.results[0]!.ok).toBe(false);
    expect(report.results[0]!.location.line).toBe(4);
    expect(report.specWarnings ?? []).toEqual([]);
  });

  it('is read big-endian too', async () => {
    const report = await run(utf16be(SPEC));

    expect(report.summary.total).toBe(1);
    expect(report.results[0]!.ok).toBe(true);
  });

  it('reads what a claim says, as the run does', async () => {
    const io = memoryIo(ROOT, {
      'docs/spec.md': utf16le('# Spec\n\n- `Specified`: the client retries.\n'),
      'src/a.ts': '',
    });
    const report = await findClaimsReport({ root: ROOT, io, config: { files: ['docs/spec.md'], labels: { Specified: {} } } });

    expect(report.totals).toEqual({ Specified: 1 });
  });
});

describe('a spec with NUL bytes and no byte order mark', () => {
  it('is warned of on its first line, with what to do', async () => {
    const report = await run(utf16le(SPEC, false));

    expect(report.summary.total).toBe(0);
    expect(report.specWarnings).toEqual([
      {
        location: expect.objectContaining({ relativeFile: 'docs/adr.md', line: 1, column: 1 }),
        kind: 'unreadable-encoding',
        message:
          'holds NUL bytes, which UTF-8 text never does, so its directives may not have been read: a file Windows PowerShell 5.1 writes with > or Out-File is UTF-16',
        hint: 'save it as UTF-8, or as UTF-16 with a byte order mark, which is read',
      },
    ]);
  });

  it('is said in every format, and fails nothing', async () => {
    const report = await run(utf16le(SPEC, false));

    expect(formatReport(report, { color: false, verbose: false })).toContain('holds NUL bytes, which UTF-8 text never does');
    expect(JSON.parse(formatJson(report)).specWarnings[0].kind).toBe('unreadable-encoding');
    expect(formatGithub(runAnnotations(report))).toMatch(/^::warning file=docs\/adr\.md,line=1,title=spec-warning::/m);
    expect(report.errors).toEqual([]);
  });
});

describe('a spec in UTF-8', () => {
  it('is read as before, with no warning, a UTF-8 byte order mark included', async () => {
    for (const spec of [SPEC, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SPEC)])]) {
      const report = await run(spec);
      expect(report.summary.total).toBe(1);
      expect(report.specWarnings ?? []).toEqual([]);
    }
  });
});

describe('decoding a document', () => {
  it('leaves the bytes it was given as they were, which are a memo key', () => {
    const bytes = utf16be('# A\n');
    const before = Buffer.from(bytes);

    expect(decodeDocument(bytes).text).toBe('# A\n');
    expect(bytes.equals(before)).toBe(true);
  });

  it('drops an odd last byte of a big-endian file, which is no character', () => {
    expect(decodeDocument(Buffer.concat([utf16be('# A'), Buffer.from([0x00])])).text).toBe('# A');
  });

  it('finds no NUL in a document a byte order mark says is UTF-16, and one in UTF-8 that holds it', () => {
    expect(decodeDocument(utf16le('a')).nul).toBe(false);
    expect(decodeDocument(utf16be('a')).nul).toBe(false);
    expect(decodeDocument(Buffer.from('a\u0000b')).nul).toBe(true);
    expect(decodeDocument(Buffer.from('ab')).nul).toBe(false);
  });

  it('reads one byte of a mark as UTF-8, since a mark is two', () => {
    expect(decodeDocument(Buffer.from([0xff, 0x41])).text).toBe('�A');
    expect(decodeDocument(Buffer.from([0xfe, 0x41])).text).toBe('�A');
  });
});
