/**
 * A file over the size limit, which neither engine's scanner reads whole.
 *
 * Until round 29 it was left out of a directory's search without a word: the
 * JSON said `skipped: []`, and a rule passed `--strict` over a 21 MiB file that
 * held the forbidden symbol. Now the walk names every such file as
 * `too-large`, and ripgrep, which searches a file of any size, hands over the
 * ones that hold a symbol to be named instead of read. Named, and not failed
 * on: spec-core's ADR-0009 holds what fails `--strict` during the format
 * freeze (ADR-0007, amended 2026-11-12).
 */

import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildRipgrepArgs, javascriptEngine, MAX_FILE_SIZE, resolveEngine, type SearchRequest } from '../src/engine.js';
import { formatJson, formatReport } from '../src/reporter.js';
import { runSpecGuard } from '../src/runner.js';
import { UNCERTAIN_REASONS } from '../src/scope.js';
import { findTestRipgrep, makeTempRepo, memoryIo, removeTempRepo, searchOptions } from './helpers.js';

const ROOT = path.resolve('/virtual/too-large');
const TOKEN = 'ForbiddenToken';
const rgPath = findTestRipgrep();

/** One byte past the limit, spaces, then the symbol at its end when asked. */
function huge(withToken: boolean): Buffer {
  const bytes = Buffer.alloc(MAX_FILE_SIZE + 1, 32);
  if (withToken) bytes.write(TOKEN, MAX_FILE_SIZE + 1 - TOKEN.length - 1);
  return bytes;
}

async function run(directive: string, files: Record<string, string | Buffer>, strict = true) {
  return runSpecGuard({
    patterns: ['docs/adr.md'],
    root: ROOT,
    io: memoryIo(ROOT, { 'docs/adr.md': `# ADR\n\n${directive}\n`, ...files }),
    strictTargets: strict,
    engine: 'javascript',
  });
}

describe('a file over the size limit in a directory scope', () => {
  it('is named in the ledger as too-large, and fails nothing under --strict yet', async () => {
    const report = await run(`<!-- @assert-absence symbol="${TOKEN}" target="data" -->`, {
      'data/dump.sql': huge(true),
      'data/small.sql': 'select 1;\n',
    });

    expect(report.results[0]!.ok).toBe(true);
    expect(report.results[0]!.scope.skipped).toEqual([{ path: 'data/dump.sql', reason: 'too-large' }]);
    expect(UNCERTAIN_REASONS.has('too-large')).toBe(false);
  });

  it('is said in the report a passing run prints, and in JSON', async () => {
    const report = await run(`<!-- @assert-absence symbol="${TOKEN}" target="data" -->`, { 'data/dump.sql': huge(false), 'data/a.sql': '' });

    expect(formatReport(report, { color: false, verbose: false })).toContain('1 file larger than 20 MiB not read: data/dump.sql');
    expect(JSON.parse(formatJson(report)).results[0].skipped).toEqual([{ path: 'data/dump.sql', reason: 'too-large' }]);
  });

  it('is not named when the rule leaves it out', async () => {
    const report = await run(`<!-- @assert-absence symbol="${TOKEN}" target="data" exclude="data/dump.sql" -->`, {
      'data/dump.sql': huge(true),
      'data/a.sql': '',
    });

    expect(report.results[0]!.scope.skipped).toEqual([]);
  });

  it('is named when it is the target itself', async () => {
    const report = await run(`<!-- @assert-absence symbol="${TOKEN}" target="data/dump.sql" -->`, { 'data/dump.sql': huge(true) });

    expect(report.results[0]!.scope.skipped).toEqual([{ path: 'data/dump.sql', reason: 'too-large' }]);
  });

  it('is named beside an import rule, which did not analyse it', async () => {
    const report = await run('<!-- @assert-import-absence module="src/db" target="src" -->', {
      'src/generated.ts': huge(false),
      'src/a.ts': "import './b';\n",
      'src/b.ts': '',
    });

    expect(report.results[0]!.ok).toBe(true);
    expect(report.results[0]!.scope.skipped).toEqual([{ path: 'src/generated.ts', reason: 'too-large' }]);
  });

  it('is not named at the limit itself, which is read', async () => {
    const report = await run(`<!-- @assert-absence symbol="${TOKEN}" target="data" -->`, { 'data/edge.sql': Buffer.alloc(MAX_FILE_SIZE, 32) });

    expect(report.results[0]!.scope.skipped).toEqual([]);
  });
});

describe('ripgrep and a file over the size limit', () => {
  it('is handed no limit, since it searches a file of any size', () => {
    const request: SearchRequest = { root: ROOT, symbol: TOKEN, targets: ['.'], options: searchOptions() };
    expect(buildRipgrepArgs(request).some((argument) => argument.startsWith('--max-filesize'))).toBe(false);
  });

  const temporary: string[] = [];
  afterEach(async () => {
    await Promise.all(temporary.splice(0).map(removeTempRepo));
  });

  it.skipIf(!rgPath)('names the one that holds the symbol, and not the one it searched and found clean', async () => {
    const root = await makeTempRepo({ 'data/with.sql': huge(true), 'data/without.sql': huge(false), 'data/a.sql': `${TOKEN}\n` });
    temporary.push(root);
    process.env.SPEC_GUARD_RG = rgPath as string;
    const ripgrep = await resolveEngine('ripgrep');
    const request: SearchRequest = { root, symbol: TOKEN, targets: ['data'], options: searchOptions() };

    const searched = await ripgrep.search(request);
    expect(searched.count).toBe(1);
    expect(searched.scope.skipped).toEqual([{ path: 'data/with.sql', reason: 'too-large' }]);

    // The walk reads no file over the limit, so it names both.
    const walked = await javascriptEngine.search(request);
    expect(walked.count).toBe(1);
    expect(walked.scope.skipped).toEqual([
      { path: 'data/with.sql', reason: 'too-large' },
      { path: 'data/without.sql', reason: 'too-large' },
    ]);
  });
});
