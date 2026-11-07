/**
 * Comment-aware searching, at the engine and runner level.
 *
 * The classifier itself is covered in comments.test.ts. What matters here is
 * that both engines reach the same answer through it, that the exclusion is
 * reported rather than silently applied, and that a single assertion is treated
 * exactly like a batched one - a real bug lived in that gap, because only the
 * batch path had been made comment-aware.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { BUILT_IN_ONLY, commentTable, type CommentTable } from '../src/comments.js';
import { createJavaScriptEngine, javascriptEngine, resolveEngine, runSearches, type SearchRequest } from '../src/engine.js';
import { nodeIo } from '../src/io.js';
import { createMemo } from '../src/memo.js';
import { runSpecGuard } from '../src/runner.js';
import type { SearchResult } from '../src/types.js';
import { findTestRipgrep, makeTempRepo, removeTempRepo, searchOptions } from './helpers.js';

const rgPath = findTestRipgrep();
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(removeTempRepo));
});

async function repo(files: Record<string, string>): Promise<string> {
  const root = await makeTempRepo(files);
  temporary.push(root);
  return root;
}

/** One comment mention, one real use, in two different files. */
const MIXED_SOURCES = {
  'src/note.ts': '// LegacyThing was removed in ADR-398\nexport const ok = true;\n',
  'src/use.ts': 'export const value = LegacyThing;\n',
};

function request(root: string, symbol: string, ignoreComments: boolean): SearchRequest {
  return {
    root,
    symbol,
    targets: ['src'],
    options: searchOptions({ ignoreComments }),
  };
}

describe('the javascript engine', () => {
  it('counts code and reports what it left in comments', async () => {
    const root = await repo(MIXED_SOURCES);
    const result = await javascriptEngine.search(request(root, 'LegacyThing', true));

    expect(result.count).toBe(1);
    expect(result.commentMatches).toBe(1);
    expect(result.matches.map((match) => match.file)).toEqual(['src/use.ts']);
  });

  it('counts everything when comments are included', async () => {
    const root = await repo(MIXED_SOURCES);
    const result = await javascriptEngine.search(request(root, 'LegacyThing', false));

    expect(result.count).toBe(2);
    expect(result.commentMatches).toBe(0);
    expect(result.matches.map((match) => match.file)).toEqual(['src/note.ts', 'src/use.ts']);
  });

  it('counts a match in an unknown language, and says it could not classify it', async () => {
    const root = await repo({ 'src/notes.unknownext': 'LegacyThing lives on here\n' });
    const result = await javascriptEngine.search(request(root, 'LegacyThing', true));

    // The conservative direction: an unreadable file's matches all count.
    expect(result.count).toBe(1);
    expect(result.unclassifiedFiles).toBe(1);
  });

  it('does not blame files that never matched', async () => {
    const root = await repo({
      'src/use.ts': 'export const value = LegacyThing;\n',
      'src/data.unknownext': 'nothing of interest\n',
      'src/more.unknownext': 'also nothing\n',
    });
    const result = await javascriptEngine.search(request(root, 'LegacyThing', true));

    expect(result.count).toBe(1);
    // Two unknown files were read; neither matched, so neither is a caveat.
    expect(result.unclassifiedFiles).toBe(0);
  });

  it('leaves the count alone when a language has no comments to find', async () => {
    const root = await repo({ 'src/use.ts': 'export const value = LegacyThing;\n' });
    const result = await javascriptEngine.search(request(root, 'LegacyThing', true));

    expect(result.count).toBe(1);
    expect(result.commentMatches).toBe(0);
    expect(result.unclassifiedFiles).toBe(0);
  });
});

describe("a file whose comment syntax the project names", () => {
  // Mente's compiler: `.mn` files comment with `//` and `///`.
  const MN = {
    'docs/spec.md': '<!-- @assert-count target="compiler" symbol="E0501 [Totality Error]" min="1" -->\n',
    'compiler/sema.mn': '/// raises E0501 [Totality Error] on a while with no decreases\nfn check() {}\n',
  };

  it('is not satisfied by a comment once the project says how the file comments', async () => {
    const root = await repo(MN);
    const named = await runSpecGuard({ patterns: ['docs/spec.md'], root, engine: 'javascript', comments: { '.mn': 'c-like' } });
    expect(named.ok).toBe(false);
    expect(named.results[0]).toMatchObject({ actual: 0, commentMatches: 1, unclassifiedFiles: 0 });

    // Without it, the file is one spec-guard could not classify: its comment
    // counts as code, and the report says so.
    const unnamed = await runSpecGuard({ patterns: ['docs/spec.md'], root, engine: 'javascript' });
    expect(unnamed.ok).toBe(true);
    expect(unnamed.results[0]).toMatchObject({ actual: 1, commentMatches: 0, unclassifiedFiles: 1 });
  });

  it('counts the code of such a file, and a file named as having no comments whole', async () => {
    const root = await repo({
      ...MN,
      'compiler/sema.mn': 'fn check() { raise("E0501 [Totality Error]") }\n// E0501 [Totality Error]\n',
      'docs/spec.md': '<!-- @assert-count target="compiler" symbol="E0501 [Totality Error]" expected="2" -->\n',
      'compiler/LICENSE-MIT': 'E0501 [Totality Error]\n',
    });
    const report = await runSpecGuard({ patterns: ['docs/spec.md'], root, engine: 'javascript', comments: { '.mn': 'c-like', 'LICENSE-MIT': 'none' } });
    expect(report.ok).toBe(true);
    expect(report.results[0]).toMatchObject({ actual: 2, commentMatches: 1, unclassifiedFiles: 0 });
  });

  it('refuses a run whose table names what is no entry, as a project exclusion that cannot be read is', async () => {
    const root = await repo(MN);
    await expect(runSpecGuard({ patterns: ['docs/spec.md'], root, engine: 'javascript', comments: { '.mn': 'cpp' } })).rejects.toThrow('".mn" for "cpp", which is no profile');
  });

  it('is scanned again under another table by a memo that keeps every scan', async () => {
    const root = await repo(MN);
    const engine = createJavaScriptEngine(nodeIo, createMemo());
    const search = (comments: CommentTable): Promise<SearchResult> =>
      engine.search({ root, symbol: 'E0501', targets: ['compiler'], options: searchOptions({ ignoreComments: true, comments }) });
    expect((await search(BUILT_IN_ONLY)).count).toBe(1);
    expect((await search(commentTable({ '.mn': 'c-like' }))).count).toBe(0);
    expect((await search(BUILT_IN_ONLY)).count).toBe(1);
  });
});

describe.skipIf(!rgPath)('ripgrep parity', () => {
  it("reads a file by the project's comment table as the scanner does", async () => {
    const root = await repo({ 'compiler/sema.mn': '/// E0501 [Totality Error]\nraise("E0501 [Totality Error]")\n' });
    process.env.SPEC_GUARD_RG = rgPath as string;
    const ripgrep = await resolveEngine('ripgrep');
    const named: SearchRequest = { root, symbol: 'E0501', targets: ['compiler'], options: searchOptions({ ignoreComments: true, comments: commentTable({ '.mn': 'c-like' }) }) };

    const viaRipgrep = await ripgrep.search(named);
    const viaScanner = await javascriptEngine.search(named);

    expect(viaRipgrep.engine).toBe('ripgrep');
    expect(viaRipgrep).toMatchObject({ count: 1, commentMatches: 1, unclassifiedFiles: 0 });
    expect(viaRipgrep.matches).toEqual(viaScanner.matches);
  });

  it('answers a single search the same way as the scanner', async () => {
    // The regression: searchBatch was comment-aware and search() was not, so a
    // spec with exactly one assertion silently kept its comment matches.
    const root = await repo(MIXED_SOURCES);
    process.env.SPEC_GUARD_RG = rgPath as string;
    const ripgrep = await resolveEngine('ripgrep');

    const viaRipgrep = await ripgrep.search(request(root, 'LegacyThing', true));
    const viaScanner = await javascriptEngine.search(request(root, 'LegacyThing', true));

    expect(viaRipgrep.count).toBe(1);
    expect(viaRipgrep.count).toBe(viaScanner.count);
    expect(viaRipgrep.commentMatches).toBe(viaScanner.commentMatches);
    expect(viaRipgrep.matches).toEqual(viaScanner.matches);
    // ripgrep did the searching, so that is what the result says.
    expect(viaRipgrep.engine).toBe('ripgrep');
  });

  it('answers a batch the same way as the scanner', async () => {
    const root = await repo({
      ...MIXED_SOURCES,
      'src/other.ts': '/* Widget is only mentioned here */\nexport const Gadget = 1;\n',
    });
    process.env.SPEC_GUARD_RG = rgPath as string;
    const ripgrep = await resolveEngine('ripgrep');

    const requests = ['LegacyThing', 'Widget', 'Gadget'].map((symbol) => request(root, symbol, true));
    const viaRipgrep = await runSearches(ripgrep, requests);
    const viaScanner = await runSearches(javascriptEngine, requests);

    expect(viaRipgrep.map((result) => result.count)).toEqual([1, 0, 1]);
    expect(viaRipgrep.map((result) => result.count)).toEqual(viaScanner.map((result) => result.count));
    expect(viaRipgrep.map((result) => result.commentMatches)).toEqual([1, 1, 0]);
    expect(viaRipgrep.map((result) => result.matches)).toEqual(viaScanner.map((result) => result.matches));
  });

  it('agrees about a regular expression, JSX text and a YAML scalar', async () => {
    // The three literals 0.11.0 taught the classifier. Both engines read the
    // file through it, so a disagreement here is a disagreement about what a
    // comment is - and each of these used to run a literal or a comment on
    // past the code below it.
    const root = await repo({
      'src/strip.ts': "export const strip = (s: string) => s.replace(/'/g, ''); // LegacyThing was removed\nexport const one = LegacyThing;\n",
      'src/tag.tsx': 'export const A = () => <div>/*</div>;\nexport const two = LegacyThing;\n',
      'src/steps.yml': "- name: Build the decoder's artefact\n# LegacyThing was removed\n- run: echo LegacyThing\n",
    });
    process.env.SPEC_GUARD_RG = rgPath as string;
    const ripgrep = await resolveEngine('ripgrep');

    const viaRipgrep = await ripgrep.search(request(root, 'LegacyThing', true));
    const viaScanner = await javascriptEngine.search(request(root, 'LegacyThing', true));

    expect(viaRipgrep.count).toBe(3);
    expect(viaRipgrep.commentMatches).toBe(2);
    expect(viaRipgrep.count).toBe(viaScanner.count);
    expect(viaRipgrep.commentMatches).toBe(viaScanner.commentMatches);
    expect(viaRipgrep.matches).toEqual(viaScanner.matches);
  });

  it('still agrees when comments are counted', async () => {
    const root = await repo(MIXED_SOURCES);
    process.env.SPEC_GUARD_RG = rgPath as string;
    const ripgrep = await resolveEngine('ripgrep');

    const viaRipgrep = await ripgrep.search(request(root, 'LegacyThing', false));
    const viaScanner = await javascriptEngine.search(request(root, 'LegacyThing', false));

    expect(viaRipgrep.count).toBe(2);
    expect(viaRipgrep.matches).toEqual(viaScanner.matches);
  });
});

describe('the comments attribute', () => {
  const spec = (attribute: string): string =>
    `<!-- @assert-absence target="src" symbol="LegacyThing"${attribute} -->\nGone.\n`;

  it('ignores comments by default, so the note about a removal is not the removal', async () => {
    const root = await repo({ ...MIXED_SOURCES, 'docs/adr.md': spec('') });
    const report = await runSpecGuard({ root, patterns: ['docs/*.md'], engine: 'javascript' });

    const [result] = report.results;
    expect(result?.actual).toBe(1);
    expect(result?.commentMatches).toBe(1);
  });

  it('counts them back in on request', async () => {
    const root = await repo({ ...MIXED_SOURCES, 'docs/adr.md': spec(' comments="include"') });
    const report = await runSpecGuard({ root, patterns: ['docs/*.md'], engine: 'javascript' });

    const [result] = report.results;
    expect(result?.actual).toBe(2);
    expect(result?.commentMatches).toBe(0);
  });

  it('passes an assertion that only a comment would have broken', async () => {
    const root = await repo({
      'src/note.ts': '// LegacyThing was removed in ADR-398\n',
      'docs/adr.md': spec(''),
    });
    const report = await runSpecGuard({ root, patterns: ['docs/*.md'], engine: 'javascript' });

    expect(report.ok).toBe(true);
    expect(report.results[0]?.commentMatches).toBe(1);
  });
});
