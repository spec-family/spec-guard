/**
 * The family's envelope, added during the format freeze (spec-core's
 * ADR-0005, amended 2026-11-12; round 29's decision D8).
 *
 * Every JSON document starts with `tool`, `toolVersion`, `command` and
 * `schemaVersion`, beside the `formatVersion` it had; a failed assertion and
 * a directive that could not be read carry `rule`, `severity` and `hint`; `-v`
 * says that it becomes `--version`; `pretty` is `human`. Nothing is renamed
 * or removed: that is round 30's.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { main, parseArgs, version, V_DEPRECATED, type CliIO } from '../src/cli.js';
import { formatJson } from '../src/reporter.js';
import { runSpecGuard } from '../src/runner.js';
import { DEMO_REPO, memoryIo } from './helpers.js';

const ROOT = path.resolve('/virtual/envelope');

describe('a run in JSON', () => {
  async function document() {
    const report = await runSpecGuard({
      patterns: ['docs/adr.md'],
      root: ROOT,
      io: memoryIo(ROOT, {
        'docs/adr.md': '# ADR\n\n<!-- @assert-absence symbol="Legacy" target="src" -->\n<!-- @assert-absence symbol="Gone" target="src" -->\n<!-- @assert-count expct="1" -->\n',
        'src/a.ts': 'new Legacy();\n',
      }),
      engine: 'javascript',
    });
    return JSON.parse(formatJson(report, { version: '1.2.3' })) as {
      results: Array<Record<string, unknown>>;
      errors: Array<Record<string, unknown>>;
    } & Record<string, unknown>;
  }

  it('starts with the envelope, its version the same as formatVersion', async () => {
    const json = await document();

    expect(json).toMatchObject({ tool: 'spec-guard', toolVersion: '1.2.3', command: 'check', schemaVersion: 1, formatVersion: 1 });
  });

  it('gives a failed assertion its rule, severity and hint, and a passed one none of them', async () => {
    const [failed, passed] = (await document()).results;

    expect(failed).toMatchObject({ ok: false, kind: 'assert-absence', rule: 'assert-absence', severity: 'error', hint: 'fix the code, or the rule if the decision it records has changed' });
    expect(passed).toMatchObject({ ok: true });
    expect(passed).not.toHaveProperty('rule');
    expect(passed).not.toHaveProperty('severity');
    expect(passed).not.toHaveProperty('hint');
  });

  it('gives a directive that could not be read the rule its annotation has', async () => {
    const [error] = (await document()).errors;

    expect(error).toMatchObject({ rule: 'invalid-directive', severity: 'error', hint: 'fix the directive: nothing it states is checked until it can be read' });
  });
});

describe('the command line', () => {
  async function cli(argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIO = { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env: {}, cwd: DEMO_REPO, isTTY: false };
    return { code: await main(argv, io), out, err };
  }

  it('writes the release it is in every JSON document', async () => {
    const { out } = await cli(['docs/adr/0001-passing.md', '--json', '--engine', 'js']);

    expect(JSON.parse(out.join('\n'))).toMatchObject({ tool: 'spec-guard', toolVersion: version(), command: 'check' });
  });

  it('says on stderr that -v becomes --version, and reads it as --verbose meanwhile', async () => {
    const short = await cli(['docs/adr/0001-passing.md', '-v', '--engine', 'js']);
    const long = await cli(['docs/adr/0001-passing.md', '--verbose', '--engine', 'js']);

    expect(short.err).toEqual([V_DEPRECATED]);
    expect(long.err).toEqual([]);
    // The same report, but for how long each took.
    const timeless = (lines: string[]): string[] => lines.map((line) => line.replace(/[0-9.]+ms/g, 'ms'));
    expect([short.code, timeless(short.out)]).toEqual([long.code, timeless(long.out)]);
    expect(V_DEPRECATED).toMatch(/^spec-guard: -v is --verbose here .* write --verbose$/);
  });

  it('reads pretty as human', () => {
    expect(parseArgs(['--format', 'pretty'], DEMO_REPO)).toMatchObject({ format: 'human', json: false });
    expect(parseArgs(['--format', 'PRETTY'], DEMO_REPO).format).toBe('human');
    expect(parseArgs(['query', 'src', '--format', 'pretty'], DEMO_REPO).format).toBe('human');
  });
});
