/**
 * A regex rule that backtracks without end.
 *
 * `symbol="(a+)+$" regex="true"` over thirty `a`s and a `!` held the scanner
 * until CI killed it, under ripgrep too once the scanner counted the file
 * ripgrep named, and froze the MCP server with it (round 29). V8's linear
 * engine refuses the lookaround and the `v` flag a regex rule is built with,
 * so a rule's match on a file now runs within a time budget, and a file it
 * was stopped on is a gap in the ledger, as an unreadable one is (ADR-0007,
 * amended 2026-11-12).
 */

import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { regexBudget, resolveEngine, withinBudget, type SearchRequest } from '../src/engine.js';
import { formatReport } from '../src/reporter.js';
import { runSpecGuard } from '../src/runner.js';
import { UNCERTAIN_REASONS } from '../src/scope.js';
import { findTestRipgrep, makeTempRepo, memoryIo, removeTempRepo, searchOptions } from './helpers.js';

const ROOT = path.resolve('/virtual/regex-budget');
const CATASTROPHIC = '(a+)+$';
// The first line backtracks without end under the pattern; the second matches
// it, which is what has ripgrep name the file.
const TRAP = `${'a'.repeat(30)}!\na\n`;

describe('the budget', () => {
  it('is a second, and a second more for each whole MiB', () => {
    expect(regexBudget(0)).toBe(1000);
    expect(regexBudget(1024 * 1024 - 1)).toBe(1000);
    expect(regexBudget(1024 * 1024)).toBe(2000);
    expect(regexBudget(20 * 1024 * 1024)).toBe(21000);
  });

  it('stops a match that backtracks without end, and the thread goes on', () => {
    const regexp = /(a+)+$/m;
    const started = performance.now();

    expect(withinBudget(() => regexp.test(TRAP), 200)).toEqual({ done: false });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(withinBudget(() => 1 + 1, 200)).toEqual({ done: true, value: 2 });
  });

  it('hands back what the work returns, and throws on what it throws', () => {
    expect(withinBudget(() => 'xx foo'.match(/foo/g)?.length, 1000)).toEqual({ done: true, value: 1 });
    expect(() => withinBudget(() => { throw new TypeError('inner'); }, 1000)).toThrow(TypeError);
  });
});

describe('a regex rule stopped on a file', () => {
  async function run(strict: boolean) {
    return runSpecGuard({
      patterns: ['docs/adr.md'],
      root: ROOT,
      io: memoryIo(ROOT, {
        'docs/adr.md': `# ADR\n\n<!-- @assert-absence symbol="${CATASTROPHIC}" regex="true" target="src" -->\n`,
        'src/trap.txt': TRAP,
        'src/clean.txt': 'b\n',
      }),
      engine: 'javascript',
      strictTargets: strict,
    });
  }

  it('names the file as a gap, which --strict fails on, and the run ends', async () => {
    const plain = await run(false);
    const strict = await run(true);

    expect(plain.results[0]!.scope.skipped).toEqual([{ path: 'src/trap.txt', reason: 'timed-out' }]);
    expect(plain.results[0]!.ok).toBe(true);
    expect(strict.results[0]!.ok).toBe(false);
    expect(UNCERTAIN_REASONS.has('timed-out')).toBe(true);
    expect(formatReport(plain, { color: false, verbose: false })).toContain(
      '1 file not searched to the end: the regular expression was still matching when its time ran out, as one that backtracks without end does: src/trap.txt',
    );
  });
});

const rgPath = findTestRipgrep();

describe.skipIf(!rgPath)('a regex rule stopped on a file ripgrep named', () => {
  const temporary: string[] = [];
  afterEach(async () => {
    await Promise.all(temporary.splice(0).map(removeTempRepo));
  });

  it('is the same gap', async () => {
    const root = await makeTempRepo({ 'src/trap.txt': TRAP });
    temporary.push(root);
    process.env.SPEC_GUARD_RG = rgPath as string;
    const ripgrep = await resolveEngine('ripgrep');
    const request: SearchRequest = { root, symbol: CATASTROPHIC, targets: ['src'], options: searchOptions({ regex: true }) };

    expect((await ripgrep.search(request)).scope.skipped).toEqual([{ path: 'src/trap.txt', reason: 'timed-out' }]);
  });
});
