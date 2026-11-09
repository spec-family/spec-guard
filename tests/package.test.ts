/**
 * The Markdown the package ships is read where the repository is not: on
 * npmjs.com, and in node_modules. A relative link there resolves against the
 * package, so a link to an ADR - which the package does not ship - leads
 * nowhere. Such a link is written as an absolute URL to the file on GitHub,
 * and a link to a file the package ships stays relative.
 *
 * The README is a front page, and the reference it links to is
 * `docs/reference/`, which the package ships beside it (round 27, decisions
 * D9 and D11): a page of the reference the README does not link to is one a
 * reader of the README does not find, and a link to a heading that moved to
 * another page leads to the top of the wrong one.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { HELP } from '../src/cli.js';
import { scanMarkdown } from '../src/vendor/spec-core/markdown/index.js';
import { PROJECT_ROOT } from './helpers.js';

const text = (file: string): string => readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
const files = (JSON.parse(text('package.json')) as { files: string[] }).files;
/** An entry with a leading slash is anchored at the root, as npm reads it. */
const entries = files.map((entry) => entry.replace(/^\//, ''));
const ships = (file: string): boolean => entries.some((entry) => file === entry || file.startsWith(`${entry}/`));

/** Where an absolute link to a file of this repository points, on its main branch. */
const REPOSITORY = 'https://github.com/spec-family/spec-guard/blob/main/';

/** The pages of the reference, root-relative. */
const REFERENCE = readdirSync(path.join(PROJECT_ROOT, 'docs/reference'))
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((name) => `docs/reference/${name}`);

/**
 * The Markdown documents the package ships. `files` names the README
 * `/README.md`: npm reads a name with no slash at any depth, and a bare
 * `README.md` packed spec-core's vendored README beside its licence.
 */
const DOCUMENTS = ['README.md', 'CHANGELOG.md', ...REFERENCE];

/** Every link a renderer follows in a document, with the line it is on. */
function linksOf(document: string): Array<{ target: string; line: number }> {
  const source = text(document);
  // Read as a renderer reads it: a link shown in code, as the README does to
  // teach the syntax, is text there and never followed.
  return scanMarkdown(source).links.map(({ target, start }) => ({ target, line: source.slice(0, start).split('\n').length }));
}

/** The anchors GitHub gives the headings of a document of this repository. */
const anchorsOf = (file: string): string[] => scanMarkdown(text(file)).headings.map((heading) => heading.anchor);

describe('the documents the package ships', () => {
  it('are the ones it names in files, and no README of spec-core\'s', () => {
    expect(DOCUMENTS.filter((document) => !ships(document))).toEqual([]);
    expect(entries.filter((entry) => entry.endsWith('.md')).sort()).toEqual(['CHANGELOG.md', 'README.md']);
    expect(files).toContain('/README.md');
    expect(files).toContain('docs/reference');
    expect(ships('src/vendor/spec-core/README.md')).toBe(false);
    // The ADRs stay out: links to them are absolute, as below.
    expect(ships('docs/adr/0001-invariants.md')).toBe(false);
  });

  it('link to a file the package does not ship by absolute URL, so that the link works on npmjs.com and in node_modules', () => {
    const dead: string[] = [];
    for (const document of DOCUMENTS) {
      for (const { target, line } of linksOf(document)) {
        if (/^(?:[a-z][a-z+.-]*:|#)/i.test(target)) continue;
        const file = path.posix.join(path.posix.dirname(document), target.split('#')[0] as string);
        if (!ships(file) || !existsSync(path.join(PROJECT_ROOT, file))) dead.push(`${document}:${line} ${target}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('link by absolute URL only to files the repository holds', () => {
    // A link made absolute is no longer checked by anything that follows
    // relative links, so an ADR renamed would leave it dead on GitHub.
    const dead: string[] = [];
    const checked: string[] = [];
    for (const document of DOCUMENTS) {
      for (const { target, line } of linksOf(document)) {
        if (!target.startsWith(REPOSITORY)) continue;
        const file = decodeURI(target.slice(REPOSITORY.length).split('#')[0] as string);
        checked.push(file);
        if (!existsSync(path.join(PROJECT_ROOT, file))) dead.push(`${document}:${line} ${target}`);
      }
    }
    expect(dead).toEqual([]);
    // The ADRs the README, the reference and the changelog cite, and the release workflow.
    expect(checked.length).toBeGreaterThanOrEqual(60);
  });

  it('link to a heading only where that document has it', () => {
    // A heading that moved to another page leaves its anchor behind, and a
    // link to it opens the top of the page it left.
    const dead: string[] = [];
    const checked: string[] = [];
    for (const document of DOCUMENTS) {
      for (const { target, line } of linksOf(document)) {
        const at = target.indexOf('#');
        if (at === -1 || /^[a-z][a-z+.-]*:/i.test(target)) continue;
        const file = at === 0 ? document : path.posix.join(path.posix.dirname(document), target.slice(0, at));
        const anchor = decodeURIComponent(target.slice(at + 1));
        checked.push(target);
        if (!existsSync(path.join(PROJECT_ROOT, file)) || !anchorsOf(file).includes(anchor)) dead.push(`${document}:${line} ${target}`);
      }
    }
    expect(dead).toEqual([]);
    // The README's own anchors, the reference's into each other, and the
    // changelog's into the README.
    expect(checked.length).toBeGreaterThanOrEqual(20);
  });
});

describe('the reference', () => {
  it('is a page for each topic, and the README links every one of them', () => {
    // A page added and never linked would be shipped and never found.
    const linked = new Set(linksOf('README.md').map(({ target }) => target.split('#')[0]));
    expect(REFERENCE.length).toBeGreaterThanOrEqual(19);
    expect(REFERENCE.filter((page) => !linked.has(page))).toEqual([]);
  });

  it('holds every command, every directive and every option --help names', () => {
    // What the README held before it became a front page: each is named in
    // the reference, where a reader of the README is sent for it.
    const reference = REFERENCE.map(text).join('\n');
    for (const command of ['query', 'mcp', 'prove', 'cites', 'claims', 'impact', '--watch']) {
      expect(reference, command).toContain(`spec-guard ${command}`);
    }
    for (const kind of ['absence', 'count', 'import-absence', 'import-count', 'layers', 'import-cycle', 'structure', 'present']) {
      expect(reference, kind).toContain(`\`@assert-${kind}\``);
    }
    const options = [...new Set(HELP.match(/--[a-z][a-z-]*[a-z]/g))];
    expect(options.length).toBeGreaterThanOrEqual(20);
    // Each in the first cell of a row of the options table, as `-v, --verbose`
    // and `--strict` / `--no-strict` are.
    const rows = text('docs/reference/cli.md').split('\n').flatMap((line) => (line.startsWith('| `-') ? [line.split(' | ')[0]!] : []));
    const named = new Set(rows.flatMap((cell) => cell.match(/--[a-z][a-z-]*[a-z]/g) ?? []));
    expect(options.filter((option) => !named.has(option))).toEqual([]);
  });
});
