/**
 * The Unicode each engine reads, measured: the limit the reference
 * (docs/reference/regex.md) and ADR-0007 state, held to the Node that runs
 * the suite and to the ripgrep `@vscode/ripgrep` pins (ADR-0007, amended
 * 2026-11-08).
 *
 * A class reads Unicode's properties as its engine has them, and Node 24
 * reads Unicode 17.0 where ripgrep 15 reads 16.0: the scanner takes code
 * points that version added for assigned, and ripgrep does not. Each Node
 * of the CI matrix measures its own difference here, through every code
 * point, and holds it to the figure this file has for its version of
 * Unicode, so that a Node or a ripgrep that reads another version fails
 * here, saying what moved and what to update, rather than leaving the
 * reference a number behind.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Not the helpers, which load src/: nothing here does.
const ROOT = join(import.meta.dirname, '..');

/** The ripgrep the lockfile pins, and never one on PATH, which may read another Unicode. */
function pinnedRipgrep(): string | null {
  try {
    return (createRequire(import.meta.url)('@vscode/ripgrep') as { rgPath: string }).rgPath;
    /* c8 ignore next 3 */
  } catch {
    return null;
  }
}

/**
 * By the Unicode the running Node reads: how many code points it assigns and
 * the pinned ripgrep leaves unassigned, and how many the other way round.
 * Measured on 2026-11-08 with ripgrep 15.0.0, Node 24.22.1 reading 17.0, and
 * Node 22.16.0 reading 16.0 as ripgrep does.
 */
const EXPECTED: Readonly<Record<string, readonly [number, number]>> = {
  '16.0': [0, 0],
  '17.0': [4803, 0],
};

const rg = pinnedRipgrep();

describe.skipIf(rg === null)('the Unicode the two engines read', () => {
  it('differs by the figure the reference and ADR-0007 state, for the Unicode this Node reads', () => {
    const ripgrep = rg as string;
    const assigned = new RegExp(String.raw`^\P{Cn}$`, 'v');
    // One code point a line, with its number, for every code point but the
    // surrogates, which no UTF-8 encodes, and the two line ends.
    const [assignedHere, unassignedHere]: [string[], string[]] = [[], []];
    for (let point = 0; point <= 0x10ffff; point += 1) {
      if ((point >= 0xd800 && point <= 0xdfff) || point === 0x0a || point === 0x0d) continue;
      const char = String.fromCodePoint(point);
      (assigned.test(char) ? assignedHere : unassignedHere).push(`${point.toString(16)} ${char}`);
    }
    const ask = (lines: string[], pattern: string): number => {
      const run = spawnSync(ripgrep, ['--no-config', '--text', '--encoding=none', '--no-line-number', '--count', '--regexp', pattern, '-'], {
        input: `${lines.join('\n')}\n`,
        encoding: 'utf8',
        maxBuffer: 1 << 20,
      });
      // 1 is ripgrep's "nothing matched", which is a count of 0.
      expect(run.status === 0 || run.status === 1, run.stderr).toBe(true);
      return Number(run.stdout.trim() || '0');
    };
    const nodeOnly = ask(assignedHere, String.raw`^[0-9a-f]+ \p{Cn}$`);
    const ripgrepOnly = ask(unassignedHere, String.raw`^[0-9a-f]+ \P{Cn}$`);

    const unicode = process.versions.unicode ?? 'unknown';
    const version = spawnSync(ripgrep, ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0];
    const expected = EXPECTED[unicode];
    const moved = [
      `Node ${process.version} reads Unicode ${unicode}, and ${version} from @vscode/ripgrep leaves ${nodeOnly} code points unassigned that it assigns, and assigns ${ripgrepOnly} that it leaves unassigned;`,
      expected === undefined ? `this file has no figure for Unicode ${unicode}.` : `this file holds ${expected[0]} and ${expected[1]} for Unicode ${unicode}.`,
      'Update the figure in docs/reference/regex.md (The Unicode each engine reads), the one in ADR-0007 (amended 2026-11-08), and EXPECTED here.',
    ].join(' ');
    expect([nodeOnly, ripgrepOnly], moved).toEqual(expected);
  });

  it('is the figure the reference and ADR-0007 give, for the version that differs', () => {
    const [figure] = EXPECTED['17.0']!;
    const written = `${Math.floor(figure / 1000)},${String(figure % 1000).padStart(3, '0')} code points`;
    expect(read('docs/reference/regex.md')).toContain(written);
    expect(read('docs/adr/0007-search-scope.md')).toContain(written);
  });
});

function read(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8');
}
