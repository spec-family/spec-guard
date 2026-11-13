/**
 * A path in another case, on a filesystem that ignores case.
 *
 * On Windows `query SRC/LOANS.JS` said no rule governs the file it opens
 * (and `exists: true`), `impact` said it was not JavaScript, and a rule's
 * `target="SRC/APP.JS"` passed locally and named nothing in CI on Linux
 * (round 29). A path asked about is now spelled as the disk spells it, as
 * spec-harness spells one, and a target or a path a rule names in another
 * case is said.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { impactOf } from '../src/impact.js';
import { spelledOnDisk, spelling, type Io } from '../src/io.js';
import { queryRules, resolveQueryPath } from '../src/query.js';
import { runSpecGuard } from '../src/runner.js';
import { memoryIo } from './helpers.js';

const ROOT = path.resolve('/virtual/case');

/** A tree in memory that opens a path whatever its case, as Windows and macOS do, and lists entries as they were written. */
function ignoringCase(files: Record<string, string>): Io {
  const io = memoryIo(ROOT, files);
  const spelled = new Map<string, string>([[ROOT.toLowerCase(), ROOT]]);
  for (const relative of Object.keys(files)) {
    let current = path.resolve(ROOT, relative);
    while (current !== ROOT && !spelled.has(current.toLowerCase())) {
      spelled.set(current.toLowerCase(), current);
      current = path.dirname(current);
    }
  }
  const real = (target: string): string => spelled.get(path.resolve(target).toLowerCase()) ?? target;
  return {
    readDirectory: (directory) => io.readDirectory(real(directory)),
    stat: (target) => io.stat(real(target)),
    readFile: (file) => io.readFile(real(file)),
    realpath: (target) => io.realpath(real(target)),
  };
}

const TREE = {
  'docs/adr.md': '# ADR\n\n<!-- @assert-absence symbol="Legacy" target="src" -->\n',
  'src/loans.js': "import './money.js';\nexport const x = 1;\n",
  'src/money.js': 'export const m = 1;\n',
};

describe('the spelling of a path on disk', () => {
  const names = (listing: Record<string, string[]>) => async (directory: string) => listing[directory] ?? null;
  const LISTING = { '.': ['src', 'Docs'], src: ['Loans.ts', 'a.ts', 'A.TS'] };

  it('keeps a segment its directory holds, and takes the one entry in another case where the path opens', async () => {
    expect(await spelledOnDisk('src/a.ts', names(LISTING), async () => true)).toBe('src/a.ts');
    expect(await spelledOnDisk('SRC/LOANS.TS', names(LISTING), async () => true)).toBe('src/Loans.ts');
    expect(await spelledOnDisk('docs', names(LISTING), async () => true)).toBe('Docs');
  });

  it('keeps the rest as written where a segment opens nothing, as on a filesystem that tells case apart', async () => {
    expect(await spelledOnDisk('SRC/new.ts', names(LISTING), async () => false)).toBe('SRC/new.ts');
    expect(await spelledOnDisk('src/NEW/x.ts', names(LISTING), async () => true)).toBe('src/NEW/x.ts');
  });

  it('spells every segment, however deep', async () => {
    const deep = { '.': ['src'], src: ['Lib'], 'src/Lib': ['Money.ts'] };
    expect(await spelledOnDisk('SRC/LIB/MONEY.TS', names(deep), async () => true)).toBe('src/Lib/Money.ts');
  });

  it('keeps a segment as written where its directory cannot be listed, and spells on below it', async () => {
    expect(await spelledOnDisk('SRC/LOANS.TS', names({ SRC: ['Loans.ts'] }), async () => true)).toBe('SRC/Loans.ts');
  });

  it('chooses no entry where two differ from the segment only in case', async () => {
    expect(await spelledOnDisk('src/a.Ts', names(LISTING), async () => true)).toBe('src/a.Ts');
  });

  it('leaves the root as it is', async () => {
    expect(await spelledOnDisk('.', names(LISTING), async () => true)).toBe('.');
    expect(await spelledOnDisk('', names(LISTING), async () => true)).toBe('');
  });
});

describe('a path asked about in another case', () => {
  it('is spelled as the disk spells it, a file to make under a directory among them', async () => {
    const io = ignoringCase(TREE);

    expect(await resolveQueryPath('SRC/LOANS.JS', ROOT, io)).toMatchObject({ path: 'src/loans.js', exists: true, absolutePath: path.resolve(ROOT, 'src/loans.js') });
    expect(await resolveQueryPath('SRC/new.ts', ROOT, io)).toMatchObject({ path: 'src/new.ts', exists: false });
  });

  it('is spelled below a directory that cannot be listed', async () => {
    const io = ignoringCase(TREE);
    const unlisted: Io = { ...io, readDirectory: (directory) => (directory === ROOT ? Promise.reject(new Error('EACCES')) : io.readDirectory(directory)) };

    expect(await spelling(unlisted, ROOT, 'SRC/LOANS.JS')).toBe('SRC/loans.js');
  });

  it('is left as written on a filesystem that tells case apart', async () => {
    expect(await resolveQueryPath('SRC/LOANS.JS', ROOT, memoryIo(ROOT, TREE))).toMatchObject({ path: 'SRC/LOANS.JS', exists: false });
  });

  it('finds the rules that govern the file it opens', async () => {
    const report = await queryRules({ patterns: ['docs/adr.md'], root: ROOT, paths: ['SRC/LOANS.JS'], io: ignoringCase(TREE) });

    expect(report.results[0]).toMatchObject({ path: 'src/loans.js', exists: true });
    expect(report.results[0]!.rules).toHaveLength(1);
  });

  it('is read as the JavaScript it is by impact', async () => {
    const report = await impactOf({ patterns: ['docs/adr.md'], root: ROOT, paths: ['SRC/MONEY.JS'], io: ignoringCase(TREE) });

    expect(report.results[0]).toMatchObject({ path: 'src/money.js', files: ['src/money.js'] });
    expect(report.results[0]!.dependents.map((dependent: { file: string }) => dependent.file)).toEqual(['src/loans.js']);
  });
});

describe('a target or a path a rule names in another case', () => {
  async function run(directives: string) {
    return runSpecGuard({
      patterns: ['docs/rules.md'],
      root: ROOT,
      io: ignoringCase({ ...TREE, 'docs/rules.md': `# Rules\n\n${directives}\n` }),
      engine: 'javascript',
    });
  }

  it('is said, and fails nothing', async () => {
    const report = await run('<!-- @assert-absence symbol="Legacy" target="SRC/LOANS.JS" -->\n<!-- @assert-present file="Src/money.js" -->');

    expect(report.results.map((result) => result.ok)).toEqual([true, true]);
    expect(report.results[0]!.warnings).toContain(
      '"SRC/LOANS.JS" is spelled "src/loans.js" on disk, and found only because this filesystem ignores case: on one that does not, as Linux\'s in CI, it names nothing (write it as the disk spells it)',
    );
    expect(report.results[1]!.warnings).toEqual([expect.stringMatching(/^"Src\/money\.js" is spelled "src\/money\.js" on disk/)]);
  });

  it('is said beside an import rule too', async () => {
    const report = await run('<!-- @assert-import-absence module="src/db" target="Src" -->');

    expect(report.results[0]!.warnings).toContain(
      '"Src" is spelled "src" on disk, and found only because this filesystem ignores case: on one that does not, as Linux\'s in CI, it names nothing (write it as the disk spells it)',
    );
  });

  it('is not said of a root given in another case', async () => {
    const root = ROOT.replace(/[a-z]/g, (letter) => letter.toUpperCase());
    const report = await runSpecGuard({
      patterns: ['docs/rules.md'],
      root,
      io: ignoringCase({ ...TREE, 'docs/rules.md': '# Rules\n\n<!-- @assert-absence symbol="Legacy" target="src/loans.js" -->\n' }),
      engine: 'javascript',
    });

    expect(report.results[0]!.warnings).toEqual([]);
  });

  it('is not said of a target reached through a link, whose real path is elsewhere, nor where the real path cannot be read', async () => {
    const base = ignoringCase({ ...TREE, 'lib/loans.js': 'export {};\n', 'docs/rules.md': '# Rules\n\n<!-- @assert-absence symbol="Legacy" target="SRC" -->\n' });
    const linked: Io = { ...base, realpath: async (target) => (path.resolve(target).toLowerCase() === path.resolve(ROOT, 'src').toLowerCase() ? path.resolve(ROOT, 'lib') : base.realpath(target)) };
    const unread: Io = { ...base, realpath: async (target) => (path.resolve(target) === path.resolve(ROOT) ? base.realpath(target) : Promise.reject(new Error('EACCES'))) };

    for (const io of [linked, unread]) {
      const report = await runSpecGuard({ patterns: ['docs/rules.md'], root: ROOT, io, engine: 'javascript' });
      expect(report.results[0]!.warnings).toEqual([]);
    }
  });

  it('is not said of one spelled as the disk spells it', async () => {
    const report = await run('<!-- @assert-absence symbol="Legacy" target="src/loans.js" -->\n<!-- @assert-present file="./src/money.js" -->');

    expect(report.results.flatMap((result) => result.warnings)).toEqual([]);
  });
});
