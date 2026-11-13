/**
 * What a run says where its first answer was no help (round 29).
 *
 * From a subdirectory, `spec-guard` said only that no spec matched; a
 * configuration file an editor began with a byte order mark was refused with
 * a message that quoted a character nobody can see; `impact` on a Python
 * module only absolute imports name said nothing imports it.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { main, repositoryAbove, type CliIO } from '../src/cli.js';
import { parseConfig, parseStandaloneConfig } from '../src/config.js';
import { formatImpact, impactOf } from '../src/impact.js';
import { runSpecGuard } from '../src/runner.js';
import { makeTempRepo, memoryIo, removeTempRepo } from './helpers.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(removeTempRepo));
});

async function cli(cwd: string, argv: string[]): Promise<{ code: number; err: string[] }> {
  const err: string[] = [];
  const io: CliIO = { stdout: () => undefined, stderr: (text) => err.push(text), env: {}, cwd, isTTY: false };
  return { code: await main(argv, io), err };
}

describe('a run from a subdirectory of a repository', () => {
  it('says where the specs are, and how to read them from there', async () => {
    const root = await makeTempRepo({ '.git/HEAD': 'ref: refs/heads/main\n', 'docs/adr.md': '# ADR\n', 'src/a.ts': '' });
    temporary.push(root);

    const { code, err } = await cli(path.join(root, 'src'), []);

    expect(code).toBe(2);
    expect(err).toEqual(['spec-guard: no spec files matched "docs/**/*.md" here; the repository starts at .., where 1 spec matches: run from there, or pass --root ..']);
  });

  it('says only that none matched where the repository holds none either, or the root is its top', async () => {
    const root = await makeTempRepo({ '.git/HEAD': 'ref: refs/heads/main\n', 'src/a.ts': '' });
    temporary.push(root);

    expect((await cli(path.join(root, 'src'), [])).err).toEqual(['spec-guard: no spec files matched "docs/**/*.md"']);
    expect((await cli(root, ['notes/*.md'])).err).toEqual(['spec-guard: no spec files matched "notes/*.md"']);
  });

  it('finds the repository however far above the root it starts, and none above the root of the filesystem', async () => {
    const root = await makeTempRepo({ '.git/HEAD': 'ref: refs/heads/main\n', 'docs/adr.md': '# ADR\n', 'src/deep/a.ts': '' });
    temporary.push(root);

    expect((await cli(path.join(root, 'src', 'deep'), [])).err).toEqual([
      'spec-guard: no spec files matched "docs/**/*.md" here; the repository starts at ../.., where 1 spec matches: run from there, or pass --root ../..',
    ]);
    expect(await repositoryAbove(path.parse(root).root)).toBeNull();
  });

  it('counts the specs it found there', async () => {
    const root = await makeTempRepo({ '.git': 'gitdir: elsewhere\n', 'docs/a.md': '# A\n', 'docs/b.md': '# B\n', 'tools/x.ts': '' });
    temporary.push(root);

    const { err } = await cli(path.join(root, 'tools'), ['query', 'x.ts']);

    expect(err).toEqual(['spec-guard: no spec files matched "docs/**/*.md" here; the repository starts at .., where 2 specs match: run from there, or pass --root ..']);
  });
});

describe('a configuration file that starts with a byte order mark', () => {
  const MARK = String.fromCharCode(0xfeff);

  it('is read as one without it', () => {
    expect(parseStandaloneConfig(`${MARK}{"specs":["docs/*.md"]}`)).toEqual({ specs: ['docs/*.md'] });
    expect(parseConfig(`${MARK}{"name":"x","specGuard":{"specs":["docs/*.md"]}}`)).toEqual({ specs: ['docs/*.md'] });
  });

  it('is read whole otherwise: a mark anywhere else is still no JSON', () => {
    expect(() => parseStandaloneConfig(`{${MARK}"specs":[]}`)).toThrow(/is not valid JSON/);
  });

  it('runs from the command line', async () => {
    const root = await makeTempRepo({ '.git/HEAD': 'x', 'docs/a.md': '# A\n', 'src/a.ts': '' });
    temporary.push(root);
    await fs.writeFile(path.join(root, '.spec-guard.json'), `${MARK}{"specs":["docs/*.md"]}\n`);

    expect((await cli(root, [])).code).toBe(0);
  });
});

describe('a missing target', () => {
  const ROOT = path.resolve('/virtual/hints-missing');

  it('is said beside a rule it does not fail, every kind of rule, and only in the message of one it fails', async () => {
    const io = memoryIo(ROOT, {
      'docs/adr.md': [
        '# ADR',
        '',
        '<!-- @assert-absence symbol="X" target="src, gone" -->',
        '<!-- @assert-import-absence module="db" target="src, gone" -->',
        '<!-- @assert-structure target="src, gone" glob="*.ts" pattern="*.ts" -->',
        '',
      ].join('\n'),
      'src/a.ts': "import './b';\n",
      'src/b.ts': '',
    });
    const allowed = await runSpecGuard({ patterns: ['docs/adr.md'], root: ROOT, io, engine: 'javascript', allowMissingTargets: true });
    const present = memoryIo(ROOT, { 'docs/adr.md': '# ADR\n\n<!-- @assert-absence symbol="X" target="src" -->\n', 'src/a.ts': '' });
    const none = await runSpecGuard({ patterns: ['docs/adr.md'], root: ROOT, io: present, engine: 'javascript', allowMissingTargets: true });
    expect(none.results[0]!.warnings).toEqual([]);
    const failing = await runSpecGuard({ patterns: ['docs/adr.md'], root: ROOT, io, engine: 'javascript' });

    expect(allowed.results.map((result) => result.warnings.includes('target path not found: gone'))).toEqual([true, true, true]);
    expect(failing.results.map((result) => [result.ok, result.message, result.warnings.includes('target path not found: gone')])).toEqual([
      [false, 'target path does not exist: gone', false],
      [false, 'target path does not exist: gone', false],
      [false, 'target path does not exist: gone', false],
    ]);
  });
});

describe('a rule over files whose imports no reader here reads', () => {
  it('names their kinds, each once and in order', async () => {
    const ROOT = path.resolve('/virtual/hints-unread');
    const io = memoryIo(ROOT, {
      'docs/adr.md': '# ADR\n\n<!-- @assert-import-absence module="db" target="src" -->\n',
      'src/a.rb': '',
      'src/b.java': '',
      'src/c.rb': '',
    });
    const [result] = (await runSpecGuard({ patterns: ['docs/adr.md'], root: ROOT, io, engine: 'javascript' })).results;

    expect(result!.message).toContain('and these are .java, .rb: a text rule');
  });
});

describe('impact on a Python module', () => {
  const ROOT = path.resolve('/virtual/hints');

  it('says only relative imports are followed, with no dependent and with some', async () => {
    const io = memoryIo(ROOT, {
      'docs/adr.md': '# ADR\n',
      'app/models.py': 'x = 1\n',
      'app/views.py': 'from app.models import x\n',
      'app/db.py': 'y = 1\n',
      'app/repo.py': 'from .db import y\n',
    });
    const text = formatImpact(await impactOf({ patterns: ['docs/adr.md'], root: ROOT, paths: ['app/models.py', 'app/db.py'], io }));

    expect(text).toContain('app/models.py\n  no relative import in scope names it; an absolute Python import names a module, which is not followed\n');
    expect(text).toContain('app/db.py\n  1 file depends on it, 1 directly, by relative imports; an absolute Python import is not followed\n');
  });

  it('leaves a JavaScript file as it was', async () => {
    const io = memoryIo(ROOT, { 'docs/adr.md': '# ADR\n', 'src/a.ts': 'export {};\n' });
    const text = formatImpact(await impactOf({ patterns: ['docs/adr.md'], root: ROOT, paths: ['src/a.ts'], io }));

    expect(text).toContain('src/a.ts\n  nothing in scope imports it\n');
  });
});
