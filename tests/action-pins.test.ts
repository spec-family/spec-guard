/**
 * The workflow a guide shows is held to the workflows this repository runs.
 *
 * The README and the CI reference (docs/reference/ci.md) pin the actions of
 * their workflows by commit, as the workflows here are pinned, and a pin
 * copied by hand stays where it was copied:
 * Dependabot moves .github/workflows and reads no Markdown. A week after the
 * examples were pinned, upload-sarif had moved here and not there. So each
 * action a guide shows must carry the major version a workflow here runs,
 * and never a version ahead of it, which nothing here has run.
 *
 * The major and no closer (the maintainer's choice, 2026-11-02): held to the
 * commit, every patch Dependabot proposed for upload-sarif failed here until
 * someone copied it into the README by hand, and a README a patch behind
 * shows a reader nothing wrong. A pin at the version the workflows run must
 * still carry their commit, since one version has one commit; a pin behind
 * them carries a commit this test cannot check without the network. A major
 * bump still fails here until the example follows (.github/dependabot.yml
 * says what to do then). spec-core's test holds its guide the same way.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Not PROJECT_ROOT from the helpers: they load src/, and nothing here does.
const ROOT = join(import.meta.dirname, '..');

interface Use {
  readonly where: string;
  /** What follows `uses:`, comment and all, as written. */
  readonly written: string;
}

/** Every `uses:` in `text` that names an action; a workflow called by its path is not one. */
function usesOf(text: string, file: string): Use[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const written = /^\s*(?:-\s+)?uses:\s+(\S.*?)\s*$/.exec(line)?.[1];
    return written === undefined || written.startsWith('./') ? [] : [{ where: `${file}:${index + 1}`, written }];
  });
}

/** `owner/action@commit # version`: the action, and the pin a reader copies. */
function pinOf(written: string): { action: string; pin: string } | null {
  const match = /^([\w.-]+(?:\/[\w.-]+)+)@([0-9a-f]{40} # v\d+\.\d+\.\d+)$/.exec(written);
  return match === null ? null : { action: match[1]!, pin: match[2]! };
}

const commitOf = (pin: string): string => pin.slice(0, pin.indexOf(' # v'));
const versionOf = (pin: string): number[] => pin.slice(pin.indexOf('# v') + 3).split('.').map(Number);

/** Whether pin `a` carries a later version than pin `b`. */
function newer(a: string, b: string): boolean {
  const [x, y] = [versionOf(a), versionOf(b)];
  const at = x.findIndex((part, index) => part !== y[index]);
  return at !== -1 && x[at]! > y[at]!;
}

/**
 * What is wrong with a guide's pin `shown` of an action the workflows here pin
 * at `here`, or null: another major, a version ahead of theirs, or their
 * version at another commit.
 */
function faultOf(shown: string, here: string): string | null {
  const [major, theirs] = [versionOf(shown)[0], versionOf(here)[0]];
  if (major !== theirs) return `v${major}, where the workflows run v${theirs} (${here})`;
  if (newer(shown, here)) return `ahead of the workflows, which run ${here}`;
  if (versionOf(shown).join('.') === versionOf(here).join('.') && commitOf(shown) !== commitOf(here)) {
    return `another commit than the workflows have for that version (${here})`;
  }
  return null;
}

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/**
 * The Markdown a reader copies from: every file but the records. The
 * changelog and the ADRs say what was so on their date, and a pin quoted
 * there is not an example to keep current.
 */
function guides(): string[] {
  const below = (directory: string): string[] =>
    readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) return entry.name === 'adr' ? [] : below(`${directory}/${entry.name}`);
      return entry.name.endsWith('.md') ? [`${directory}/${entry.name}`] : [];
    });
  const top = readdirSync(ROOT).filter((name) => name.endsWith('.md') && name !== 'CHANGELOG.md');
  return [...top, ...below('docs')].sort();
}

describe('a pin a guide shows, beside the pin the workflows have', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);

  it('passes at the major the workflows run, behind them or at their pin', () => {
    expect(faultOf(`${A} # v4.39.1`, `${B} # v4.40.0`)).toBeNull();
    expect(faultOf(`${A} # v4.39.1`, `${B} # v4.39.2`)).toBeNull();
    expect(faultOf(`${B} # v4.39.1`, `${B} # v4.39.1`)).toBeNull();
  });

  it('fails another major, either way', () => {
    expect(faultOf(`${A} # v3.29.0`, `${B} # v4.39.1`)).toBe(`v3, where the workflows run v4 (${B} # v4.39.1)`);
    expect(faultOf(`${A} # v5.0.0`, `${B} # v4.39.1`)).toBe(`v5, where the workflows run v4 (${B} # v4.39.1)`);
  });

  it('fails a version ahead of the workflows, by a minor or a patch', () => {
    expect(faultOf(`${A} # v4.40.0`, `${B} # v4.39.9`)).toBe(`ahead of the workflows, which run ${B} # v4.39.9`);
    expect(faultOf(`${A} # v4.39.2`, `${B} # v4.39.1`)).toBe(`ahead of the workflows, which run ${B} # v4.39.1`);
  });

  it("fails the workflows' version at another commit", () => {
    expect(faultOf(`${A} # v4.39.1`, `${B} # v4.39.1`)).toBe(`another commit than the workflows have for that version (${B} # v4.39.1)`);
  });
});

describe('the workflows the guides show', () => {
  const shown = guides().flatMap((file) => usesOf(read(file), file));
  const run = readdirSync(join(ROOT, '.github/workflows'))
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) => usesOf(read(`.github/workflows/${name}`), name));

  /**
   * Each action the workflows here run, with the newest pin they have for it.
   * Dependabot moves every workflow at once, so there is one; where a hand
   * has moved a single workflow, that one is where the rest are going.
   */
  const pinned = new Map<string, string>();
  for (const { written } of run) {
    const use = pinOf(written);
    const held = use === null ? undefined : pinned.get(use.action);
    if (use !== null && (held === undefined || newer(use.pin, held))) pinned.set(use.action, use.pin);
  }

  it('are found, and so are the workflows they are held to', () => {
    // A guide that moved, or a line this file no longer reads, would leave
    // the checks below nothing to fail on.
    // The README shows the job, and the CI reference shows it with the SARIF
    // upload beside it.
    const where = (action: string): string[] => shown.filter((use) => pinOf(use.written)?.action === action).map((use) => use.where.split(':')[0]!);
    expect(where('actions/checkout')).toEqual(expect.arrayContaining(['README.md', 'docs/reference/ci.md']));
    expect(where('github/codeql-action/upload-sarif')).toContain('docs/reference/ci.md');
    expect([...pinned.keys()]).toEqual(expect.arrayContaining(['actions/checkout', 'actions/setup-node', 'github/codeql-action/upload-sarif']));
  });

  it('pin every action to a commit, with its version beside it', () => {
    expect(shown.filter((use) => pinOf(use.written) === null).map((use) => `${use.where}: ${use.written}`)).toEqual([]);
  });

  it('pin each action at the major the workflows here run, and never ahead of them', () => {
    const faults = shown.flatMap((use) => {
      const { action, pin } = pinOf(use.written) ?? { action: '', pin: '' };
      const here = pinned.get(action);
      const fault = here === undefined ? null : faultOf(pin, here);
      return fault === null ? [] : [`${use.where}: ${action}@${pin} is ${fault}`];
    });
    expect(faults).toEqual([]);
  });

  it('show no action that no workflow here runs', () => {
    // No bump would reach its pin, and nothing would say when it fell behind.
    const unheld = shown.flatMap((use) => {
      // One written without a commit is the test before last's to report.
      const action = pinOf(use.written)?.action;
      return action === undefined || pinned.has(action) ? [] : [`${use.where}: ${use.written}`];
    });
    expect(unheld).toEqual([]);
  });
});
