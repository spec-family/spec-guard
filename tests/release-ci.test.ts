/**
 * A release runs every leg of CI on the commit it stages.
 *
 * A pull request runs three of the matrix's twelve legs (spec-core's ADR-0008,
 * amended 2026-11-12), a tag push runs no CI, and main's CI is cancelled by a
 * newer push. So `release.yml` calls `ci.yml` on the tagged commit, and
 * nothing is packed or staged unless every job of it passed (ADR-0019,
 * amended 2026-11-12). Called from another workflow, `github` is the
 * caller's context, so the event the matrix reads is the release's own: the
 * tag's push, or a dispatch.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

const read = (name: string): string => readFileSync(join(ROOT, '.github/workflows', name), 'utf8').replace(/\r\n/g, '\n');

/** A line without its comment, since a comment runs nothing. */
const code = (line: string): string => line.replace(/(?:^|\s)#.*$/, '');

/** The keys directly under a top-level `section` (`on` or `jobs`), each with its lines. */
function blocks(text: string, section: string): Map<string, string[]> {
  const lines = text.split('\n').map(code);
  const start = lines.indexOf(`${section}:`);
  expect(start, `${section}: is read`).toBeGreaterThanOrEqual(0);
  const found = new Map<string, string[]>();
  let current: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const key = /^ {2}([\w-]+):/.exec(line);
    if (key !== null) found.set(key[1]!, (current = []));
    current.push(line);
  }
  return found;
}

/** What a job's `needs:` lists, written on one line as the workflows here write it. */
function needsOf(job: readonly string[]): string[] {
  const line = job.map((text) => /^ {4}needs:\s*(\S.*?)\s*$/.exec(text)).find((match) => match !== null);
  return line ? line[1]!.replace(/^\[|\]$/g, '').split(',').map((name) => name.trim()) : [];
}

/** Every job `name` waits on, through the jobs it waits on. */
function upstream(jobs: Map<string, string[]>, name: string): Set<string> {
  const seen = new Set<string>();
  const visit = (job: string): void => {
    for (const need of needsOf(jobs.get(job) ?? [])) {
      if (!seen.has(need)) {
        seen.add(need);
        visit(need);
      }
    }
  };
  visit(name);
  return seen;
}

const ci = read('ci.yml');
const release = read('release.yml');
const ciJobs = blocks(ci, 'jobs');
const releaseJobs = blocks(release, 'jobs');

/** A one-line list of the matrix's, such as `os: [a, b]`. */
function axis(name: string): string[] {
  const line = (ciJobs.get('test') ?? []).map((text) => new RegExp(`^ {8}${name}: \\[(.*)\\]$`).exec(text)).find((match) => match !== null);
  expect(line, `the matrix's ${name}`).toBeDefined();
  return line![1]!.split(',').map((value) => value.trim().replace(/^'|'$/g, ''));
}

/**
 * The legs the matrix runs for an event. The `exclude` expression is read as
 * the one form it has, `event == '<name>' && '<list>' || '[]'`; a change to
 * that form fails here first, so whoever makes it says what each event runs.
 */
function legs(event: string): string[] {
  const line = (ciJobs.get('test') ?? []).map((text) => /^ {8}exclude: \$\{\{ fromJSON\(github\.event_name == '(\w+)' && '(\[.*\])' \|\| '(\[.*\])'\) \}\}$/.exec(text)).find((match) => match !== null);
  expect(line, 'the exclude expression').toBeDefined();
  const [, only, narrowed, otherwise] = line!;
  const excluded: Array<Record<string, string>> = JSON.parse(event === only ? narrowed! : otherwise!);
  return axis('os')
    .flatMap((os) => axis('node').map((node) => ({ os, node })))
    .filter((leg: Record<string, string>) => !excluded.some((rule) => Object.entries(rule).every(([key, value]) => leg[key] === value)))
    .map(({ os, node }) => `${os}, node ${node}`);
}

describe("the matrix's legs", () => {
  it('are three for a pull request: the floor and the current release on the gates\' image, and the floor on Windows', () => {
    expect(legs('pull_request')).toEqual(['ubuntu-24.04, node 22', 'ubuntu-24.04, node 26', 'windows-2025-vs2026, node 22']);
  });

  // A tag's push is the same event as a push to main.
  it('are all twelve for every event that starts a release', () => {
    const events = [...blocks(release, 'on').keys()];
    expect(events).toEqual(['push', 'workflow_dispatch']);
    for (const event of events) expect(legs(event), event).toHaveLength(12);
  });
});

describe('a release', () => {
  const caller = [...releaseJobs].find(([, lines]) => lines.some((line) => /^ {4}uses: \.\/\.github\/workflows\/ci\.yml\s*$/.test(line)));

  it('calls ci.yml, which can be called', () => {
    expect(blocks(ci, 'on').has('workflow_call')).toBe(true);
    expect(caller?.[0]).toBe('ci');
  });

  it('packs and stages nothing unless ci.yml passed as a whole', () => {
    expect(upstream(releaseJobs, 'verify')).toContain('ci');
    expect(upstream(releaseJobs, 'publish')).toContain('ci');
    // A job runs after a failed one it needs only when its condition says so.
    for (const job of ['verify', 'publish']) {
      expect((releaseJobs.get(job) ?? []).filter((line) => /^ {4}if:.*\b(?:always|failure|cancelled)\(/.test(line)), job).toEqual([]);
    }
  });

  it("fails ci.yml with any of its jobs, since `all green` needs every one", () => {
    const others = [...ciJobs.keys()].filter((job) => job !== 'all-green');
    expect(needsOf(ciJobs.get('all-green') ?? []).sort()).toEqual(others.sort());
    expect(others).toEqual(expect.arrayContaining(['test', 'scan', 'coverage']));
  });
});
