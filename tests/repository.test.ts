/**
 * Where the package says it comes from, and what still names where it came
 * from before.
 *
 * npm's trusted publishing hands a token only to the repository and the
 * workflow named on npmjs.com, and checks provenance against the repository
 * `package.json` names: a `repository.url` left pointing elsewhere is a
 * release that fails at its last step, on the tag (ADR-0019, amended
 * 2026-10-26). That day the family moved to the spec-family organization and
 * the @spec-family scope, and the old scope holds no release after 0.29.0:
 * a reference to it that is not a record of the move sends a reader to a
 * package that stopped there.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Not PROJECT_ROOT from the helpers: they load src/, and nothing here does.
const ROOT = join(import.meta.dirname, '..');

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/**
 * The scope and the organization the family left, in any case, as GitHub
 * reads an owner. Written in two parts, so that this file holds neither.
 */
const LEFT = new RegExp(`${'@descent'}-vtt|${'descent'}vtt/`, 'i');

/** A date, which makes a line a record of its day. */
const DATED = /\b20\d\d-\d\d-\d\d\b/;

/**
 * The records, which say what was so on their date: the changelog and the
 * ADRs. A pin or a name quoted there is no example to keep current, as
 * tests/action-pins.test.ts reads them.
 */
const isRecord = (file: string): boolean => file === 'CHANGELOG.md' || file.startsWith('docs/adr/');

/**
 * Each line of a file that names the scope or the organization the family
 * left, outside a record, where neither it nor the line above it says when:
 * a test that holds the old name to what it means says the day the family
 * left it.
 */
function stale(file: string, text: string): string[] {
  if (isRecord(file)) return [];
  const lines = text.split(/\r?\n/);
  return lines.flatMap((line, index) =>
    LEFT.test(line) && !DATED.test(line) && !DATED.test(lines[index - 1] ?? '') ? [`${file}:${index + 1}: ${line.trim()}`] : [],
  );
}

/**
 * Every file of the repository a reader or a tool reads, by path from the
 * root: not what is installed or built, not another work tree below this one,
 * and not what a test writes while it runs.
 */
function files(directory = ''): string[] {
  const skipped = new Set(['.git', 'node_modules', 'dist', 'coverage', 'reports', '.stryker-tmp', '.claude', '.tmp']);
  return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = directory === '' ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) return skipped.has(entry.name) ? [] : files(path);
    return entry.isFile() ? [path] : [];
  });
}

describe('the repository package.json names', () => {
  it('is this one, which npm publishes from with provenance, and so are its issues; its page is the site of the family', () => {
    const manifest = JSON.parse(read('package.json')) as { name: string; repository: unknown; bugs: unknown; homepage: string };
    expect(manifest.name).toBe('@spec-family/spec-guard');
    expect(manifest.repository).toEqual({ type: 'git', url: 'git+https://github.com/spec-family/spec-guard.git' });
    expect(manifest.bugs).toEqual({ url: 'https://github.com/spec-family/spec-guard/issues' });
    expect(manifest.homepage).toBe('https://spec-family.github.io');
  });
});

describe('a name the family left', () => {
  const old = `${'@descent'}-vtt/spec-guard`;
  const owner = `${'Descent'}VTT/spec-guard`;

  it('is stale where a line names it and says not when, in any file but a record', () => {
    expect(stale('README.md', `npx --no-install ${old} "docs/**/*.md"`)).toEqual([`README.md:1: npx --no-install ${old} "docs/**/*.md"`]);
    expect(stale('src/reporter.ts', `  informationUri: 'https://github.com/${owner}',`)).toEqual([`src/reporter.ts:1: informationUri: 'https://github.com/${owner}',`]);
    expect(stale('docs/guide.md', `see github.com/${owner.toLowerCase()}`)).toHaveLength(1);
    // A date two lines up is another line's.
    expect(stale('tests/x.test.ts', `// left on 2026-10-26\n\n'${old}'`)).toEqual([`tests/x.test.ts:3: '${old}'`]);
  });

  it('is a record where the line or the one above it says when, and in the changelog and the ADRs', () => {
    expect(stale('tests/x.test.ts', `// The scope the family left on 2026-10-26.\n['npx ${old}'],`)).toEqual([]);
    expect(stale('README.md', `0.29.0 was the last as ${old} (2026-10-26).`)).toEqual([]);
    expect(stale('CHANGELOG.md', `npm uninstall ${old}`)).toEqual([]);
    expect(stale('docs/adr/0019-releases-are-staged-by-ci.md', `from ${owner}`)).toEqual([]);
    expect(stale('docs/adrs.md', `from ${owner}`)).toHaveLength(1);
    expect(stale('README.md', 'npx --no-install @spec-family/spec-guard')).toEqual([]);
  });

  it('is named nowhere in the repository but in a record', () => {
    const found = files();
    // The walk reaches the files this would have to fail on.
    expect(found).toEqual(expect.arrayContaining(['README.md', 'package.json', 'src/reporter.ts', 'tests/names.test.ts', '.github/workflows/release.yml']));
    expect(found.filter((file) => file.includes('node_modules/') || file.startsWith('dist/'))).toEqual([]);
    expect(found.flatMap((file) => stale(file, read(file)))).toEqual([]);
  });
});
