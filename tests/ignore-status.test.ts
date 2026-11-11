/**
 * `ignoreStatus` as a list of spec patterns: the documents it matches are read
 * with no status, so they are in force (ADR-0010, amended 2026-11-11).
 *
 * Spec Kit writes every specification `**Status**: Draft` and never changes
 * it, so its rules never ran and a claim's test under it was no evidence.
 * Each test here is paired, as spec-status.test.ts pairs its own: what the
 * list reads in force is shown withheld without it, and a document it does
 * not match is shown withheld with it, so the list is known to have changed
 * that document and no other.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findClaimsReport, type ClaimsConfig } from '../src/claims.js';
import { EXIT_ERROR, EXIT_FAILED, EXIT_OK, main, type CliIO } from '../src/cli.js';
import { parseConfig } from '../src/config.js';
import { createMcpHandler } from '../src/mcp.js';
import { proveSpecGuard } from '../src/prove.js';
import { queryRules } from '../src/query.js';
import { runSpecGuard } from '../src/runner.js';
import { createDocumentMemo, readSpecs } from '../src/specs.js';
import { createSession } from '../src/watch.js';
import { makeTempRepo, removeTempRepo } from './helpers.js';

/** A specification as Spec Kit writes it: `Draft`, with a claim and the count of its test under it. */
const SPEC = [
  '# Feature Specification: Refunds',
  '',
  '**Feature Branch**: `001-refunds`',
  '**Status**: Draft',
  '',
  '## Requirements',
  '',
  '- `Implemented`: a refund over the capture is refused.',
  '  <!-- @assert-count target="src" symbol="fn test_refund_limit" min="1" -->',
  '',
].join('\n');

/** A plan beside it, also `Draft`, whose rule fails, so a run of it is seen. */
const PLAN = '# Plan: Refunds\n\n**Status**: Draft\n\n<!-- @assert-absence target="src" symbol="Legacy" -->\n';

/** A draft decision whose rule fails: a list that names the specifications leaves it a draft. */
const ADR = '# ADR-0001: Clocks\n\n## Status\n\nDraft.\n\n<!-- @assert-absence target="src" symbol="Legacy" -->\n';

const FILES = {
  'specs/001-refunds/spec.md': SPEC,
  'specs/001-refunds/plan.md': PLAN,
  'docs/adr/0001-clocks.md': ADR,
  'src/lib.rs': 'fn test_refund_limit() {}\nconst Legacy = 1;\n',
};

const PATTERNS = ['specs/**/*.md', 'docs/**/*.md'];
const SPECS_ONLY = ['specs/**/spec.md'];
const CLAIMS: ClaimsConfig = { files: ['specs/**/spec.md'], labels: { Implemented: { evidence: 'test' } }, testPrefixes: ['fn test_'] };

let root: string;
const temporary: string[] = [];

beforeAll(async () => {
  root = await makeTempRepo(FILES);
});

afterAll(async () => {
  await Promise.all([root, ...temporary].map(removeTempRepo));
});

const run = (ignoreStatus?: boolean | string[]) =>
  runSpecGuard({ patterns: PATTERNS, root, engine: 'javascript', ...(ignoreStatus === undefined ? {} : { ignoreStatus }) });

describe('a run', () => {
  it('runs the rules of the documents a list matches, with no status, and withholds the rest', async () => {
    const without = await run();
    expect(without.summary.total).toBe(0);
    expect(without.inactiveSpecs.map((spec) => spec.file)).toEqual(['docs/adr/0001-clocks.md', 'specs/001-refunds/plan.md', 'specs/001-refunds/spec.md']);

    const listed = await run(SPECS_ONLY);
    expect(listed.ok).toBe(true);
    expect(listed.summary).toMatchObject({ total: 1, passed: 1 });
    expect(listed.results.map((result) => result.location.relativeFile)).toEqual(['specs/001-refunds/spec.md']);
    expect(listed.inactiveSpecs.map((spec) => spec.file)).toEqual(['docs/adr/0001-clocks.md', 'specs/001-refunds/plan.md']);
  });

  it('reads a pattern as a spec pattern is read, so a directory names its Markdown files', async () => {
    const report = await run(['specs']);
    expect(report.ok).toBe(false);
    expect(report.results.map((result) => [result.location.relativeFile, result.ok])).toEqual([
      ['specs/001-refunds/plan.md', false],
      ['specs/001-refunds/spec.md', true],
    ]);
    expect(report.inactiveSpecs.map((spec) => spec.file)).toEqual(['docs/adr/0001-clocks.md']);
  });

  it('leaves true as it was: every rule runs, and false and nothing read every status', async () => {
    const everything = await run(true);
    expect(everything.summary).toMatchObject({ total: 3, failed: 2 });
    expect(everything.inactiveSpecs).toEqual([]);
    expect((await run(false)).inactiveSpecs).toHaveLength(3);
  });

  it('passes the list on from a watch session', async () => {
    const session = (ignoreStatus?: string[]) =>
      createSession({ root, settings: async () => ({ patterns: PATTERNS, run: { engine: 'javascript', ...(ignoreStatus === undefined ? {} : { ignoreStatus }) } }) });
    expect((await session().run()).report.summary.total).toBe(0);
    expect((await session(SPECS_ONLY).run()).report.summary).toMatchObject({ total: 1, passed: 1 });
  });
});

describe('the warnings about a status', () => {
  const documents = {
    // A status written in a word spec-guard does not read, and front matter
    // never closed: each is said of a document whose status is read.
    'specs/a.md': '# A\n\n**Status**: 草稿\n\n<!-- @assert-absence target="src" symbol="Gone" -->\n',
    'specs/b.md': '---\nstatus: draft\n# B\n\n<!-- @assert-absence target="src" symbol="Gone" -->\n',
    // A fence never closed hides the directives after it, whatever the status.
    'specs/c.md': '# C\n\n<!-- @assert-absence target="src" symbol="Gone" -->\n\n```text\n<!-- @assert-absence target="src" symbol="Hidden" -->\n',
    'src/a.ts': 'export const a = 1;\n',
  };

  it('are not said of a document whose status is not read, and a block never closed still is', async () => {
    const tree = await makeTempRepo(documents);
    temporary.push(tree);
    const kinds = async (ignoreStatus?: string[]) =>
      (await readSpecs(['specs'], tree, undefined, undefined, ignoreStatus)).warnings.map((warning) => [warning.location.relativeFile, warning.kind]);
    const all = [
      ['specs/a.md', 'unreadable-status'],
      ['specs/b.md', 'unclosed-front-matter'],
      ['specs/c.md', 'unclosed-block'],
    ];
    expect(await kinds()).toEqual(all);
    expect(await kinds(['specs/a.md'])).toEqual([all[1], all[2]]);
    expect(await kinds(['specs/b.md'])).toEqual([all[0], all[2]]);
    expect(await kinds(['specs'])).toEqual([all[2]]);
  });
});

describe('a query', () => {
  it('lists the rules of a document the list matches as in force, with no status, and withholds the rest', async () => {
    const ask = (ignoreStatus?: string[]) => queryRules({ patterns: PATTERNS, root, paths: ['src/lib.rs'], ...(ignoreStatus === undefined ? {} : { ignoreStatus }) });
    const without = (await ask()).results[0]!;
    expect(without.rules).toEqual([]);
    expect(without.withheld.rules).toBe(3);

    const report = await ask(SPECS_ONLY);
    const [result] = report.results;
    expect(result!.rules.map((rule) => rule.document)).toEqual(['specs/001-refunds/spec.md']);
    expect(result!.withheld).toEqual({ rules: 2, documents: ['docs/adr/0001-clocks.md', 'specs/001-refunds/plan.md'] });
    expect(report.documents.find((document) => document.file === 'specs/001-refunds/spec.md')).toMatchObject({ status: null, label: null, inForce: true });
  });

  it('keeps one parse of each document in a memo, whatever the list says of it', async () => {
    const memo = createDocumentMemo();
    const spec = async (ignoreStatus?: string[]) =>
      (await memo.read(PATTERNS, root, undefined, ignoreStatus)).documents.find((document) => document.relativeFile === 'specs/001-refunds/spec.md');
    expect(await spec(SPECS_ONLY)).toMatchObject({ inForce: true });
    expect((await spec(SPECS_ONLY))?.status).toBeUndefined();
    expect(await spec()).toMatchObject({ inForce: false, status: { value: 'draft' } });
  });
});

describe('prove', () => {
  it('proves the rules of a document the list matches', async () => {
    const proved = async (ignoreStatus?: string[]) =>
      (await proveSpecGuard({ patterns: PATTERNS, root, ...(ignoreStatus === undefined ? {} : { ignoreStatus }) })).results.map((result) => result.location.relativeFile);
    expect(await proved()).toEqual([]);
    expect(await proved(SPECS_ONLY)).toEqual(['specs/001-refunds/spec.md']);
  });
});

describe('claims', () => {
  it('counts the directive under a claim of a document the list matches, or under every claim for true', async () => {
    const without = await findClaimsReport({ root, config: CLAIMS });
    expect(without.findings.map((finding) => finding.message)).toEqual([
      '`Implemented` needs a test, and the directive naming one at line 9 is no evidence: its document is not in force, so the rule is not run',
    ]);
    for (const ignoreStatus of [SPECS_ONLY, true]) {
      const report = await findClaimsReport({ root, config: CLAIMS, ignoreStatus });
      expect(report.ok, JSON.stringify(ignoreStatus)).toBe(true);
      expect(report.claims).toEqual([{ file: 'specs/001-refunds/spec.md', line: 8, label: 'Implemented', evidence: ['specs/001-refunds/spec.md:9'] }]);
    }
    // A list that matches another document leaves this one's status read.
    expect((await findClaimsReport({ root, config: CLAIMS, ignoreStatus: ['docs'] })).ok).toBe(false);
  });
});

describe('the MCP server', () => {
  interface ToolResult {
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  }
  const call = async (name: string, args: Record<string, unknown>, ignoreStatus: boolean | string[]): Promise<ToolResult> => {
    const handle = createMcpHandler({ root, patterns: PATTERNS, version: '9.9.9', run: { engine: 'javascript', ignoreStatus } });
    const response = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as { result: ToolResult };
    return response.result;
  };

  it('lists the rules of a document the list matches, and no others by default, from either tool that lists rules', async () => {
    const rules = await call('get_architectural_rules', { path: 'src/lib.rs' }, SPECS_ONLY);
    expect(rules.isError).toBeUndefined();
    const [result] = (rules.structuredContent as { results: Array<{ rules: Array<{ document: string }>; withheld: { rules: number } }> }).results;
    expect(result!.rules.map((rule) => rule.document)).toEqual(['specs/001-refunds/spec.md']);
    expect(result!.withheld.rules).toBe(2);
    // true lists the rules of every document not in force, as it did.
    const everything = await call('get_architectural_rules', { path: 'src/lib.rs' }, true);
    const [all] = (everything.structuredContent as { results: Array<{ rules: unknown[] }> }).results;
    expect(all!.rules).toHaveLength(3);

    const dependents = await call('get_dependents', { paths: ['src/lib.rs'] }, SPECS_ONLY);
    expect(dependents.isError).toBeUndefined();
    expect((dependents.structuredContent as { rules: Array<{ document: string }> }).rules.map((rule) => rule.document)).toEqual(['specs/001-refunds/spec.md']);
  });
});

describe('the command line and the configuration', () => {
  function createIO(cwd: string) {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIO = { stdout: (text) => out.push(text), stderr: (text) => err.push(text), cwd, env: {}, isTTY: false };
    return { io, out, err };
  }

  async function project(config: Record<string, unknown>): Promise<string> {
    const tree = await makeTempRepo({ ...FILES, '.spec-guard.json': JSON.stringify(config) });
    temporary.push(tree);
    return tree;
  }

  it('takes a list in the configuration for a run, a query and claims, and the command line overrides it', async () => {
    const tree = await project({ specs: PATTERNS, ignoreStatus: SPECS_ONLY, claims: CLAIMS });
    const checked = createIO(tree);
    expect(await main(['--root', tree, '--engine', 'js', '--ascii'], checked.io)).toBe(EXIT_OK);
    expect(checked.out.join('\n')).toContain('options from .spec-guard.json: specs, ignoreStatus\n\n1 passed');

    const asked = createIO(tree);
    expect(await main(['query', 'src/lib.rs', '--root', tree, '--format', 'json'], asked.io)).toBe(EXIT_OK);
    const [result] = (JSON.parse(asked.out.join('')) as { results: Array<{ rules: Array<{ document: string }>; withheld: { rules: number } }> }).results;
    expect(result!.rules.map((rule) => rule.document)).toEqual(['specs/001-refunds/spec.md']);
    expect(result!.withheld.rules).toBe(2);

    const impact = createIO(tree);
    expect(await main(['impact', 'src/lib.rs', '--root', tree, '--format', 'json'], impact.io)).toBe(EXIT_OK);
    expect((JSON.parse(impact.out.join('')) as { rules: Array<{ document: string }> }).rules.map((rule) => rule.document)).toEqual(['specs/001-refunds/spec.md']);

    const claims = createIO(tree);
    expect(await main(['claims', '--root', tree, '--format', 'json'], claims.io)).toBe(EXIT_OK);
    expect(JSON.parse(claims.out.join(''))).toMatchObject({ ok: true, config: { file: '.spec-guard.json', applied: ['ignoreStatus', 'claims'], overridden: [] } });

    const overridden = createIO(tree);
    expect(await main(['claims', '--root', tree, '--no-ignore-status', '--ascii'], overridden.io)).toBe(EXIT_FAILED);
    expect(overridden.out.join('\n')).toContain('options from .spec-guard.json: claims; overridden on the command line: ignoreStatus');
    const all = createIO(tree);
    expect(await main(['--root', tree, '--engine', 'js', '--ignore-status'], all.io)).toBe(EXIT_FAILED);
  });

  it('refuses a list that names nothing, an entry that is no pattern, and a pattern spec-guard cannot read, before anything runs', async () => {
    const said = (value: unknown): string => {
      try {
        parseConfig(JSON.stringify({ specGuard: { ignoreStatus: value } }));
      } catch (error) {
        return (error as Error).message;
      }
      return 'accepted';
    };
    expect(said(['specs/**/spec.md'])).toBe('accepted');
    expect(said(true)).toBe('accepted');
    expect(said(false)).toBe('accepted');
    const shape = 'package.json: "specGuard.ignoreStatus" must be true, false or a non-empty list of spec globs whose documents\' status is not read, got';
    expect(said([])).toBe(`${shape} an array.`);
    expect(said(['specs', 3])).toBe(`${shape} an array.`);
    expect(said(['  '])).toBe(`${shape} an array.`);
    expect(said('specs')).toBe(`${shape} "specs".`);
    expect(said(1)).toBe(`${shape} 1.`);
    expect(said(['specs/**.md'])).toMatch(/^package\.json: "specGuard\.ignoreStatus" has an invalid spec pattern "specs\/\*\*\.md": /);

    const tree = await project({ ignoreStatus: [] });
    const refused = createIO(tree);
    expect(await main(['--root', tree, '--engine', 'js'], refused.io)).toBe(EXIT_ERROR);
    expect(refused.out).toEqual([]);
  });
});
