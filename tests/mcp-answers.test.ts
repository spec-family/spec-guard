/**
 * The MCP server's answers, bounded and honest (round 29).
 *
 * `get_dependents` on a chain of 5,000 files answered 571 KB of text and
 * 26 MB of structured content; `check_architecture` said a path that is not
 * there passed, ran no rule of a spec named by its path, and read only what
 * was saved; there was no claims tool, and `get_architectural_rules` took one
 * path.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpHandler, MAX_DEPENDENTS, type McpServerOptions } from '../src/mcp.js';
import { makeTempRepo, removeTempRepo } from './helpers.js';

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const CHAIN = 12;
let root: string;

beforeAll(async () => {
  const files: Record<string, string> = {
    'docs/adr.md': '# ADR\n\n<!-- @assert-import-absence target="src/domain" module="src/infra" -->\n',
    'src/domain/order.ts': 'export const order = 1;\n',
    'src/infra/db.ts': 'export const db = 1;\n',
    'chain/c0.ts': 'export const c0 = 0;\n',
  };
  for (let at = 1; at < CHAIN; at++) files[`chain/c${at}.ts`] = `import { c${at - 1} } from './c${at - 1}.js';\nexport const c${at} = c${at - 1};\n`;
  root = await makeTempRepo(files);
});

afterAll(async () => {
  await removeTempRepo(root);
});

async function tool(name: string, args: Record<string, unknown>, overrides: Partial<McpServerOptions> = {}): Promise<ToolResult> {
  const handle = createMcpHandler({ root, patterns: ['docs/**/*.md'], version: '9.9.9', run: { engine: 'javascript' }, ...overrides });
  const response = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as unknown as { result: ToolResult };
  return response.result;
}

describe('get_dependents', () => {
  it('lists the nearest max_files dependents of a path and counts the rest', async () => {
    const called = await tool('get_dependents', { paths: ['chain/c0.ts'], max_files: 3 });
    const [result] = called.structuredContent?.['results'] as Array<{ dependents: Array<{ file: string; depth: number }>; truncated?: number }>;

    expect(result!.dependents.map((dependent) => dependent.depth)).toEqual([1, 2, 3]);
    expect(result!.truncated).toBe(CHAIN - 1 - 3);
    expect(called.content[0]?.text).toContain(`chain/c0.ts\n  ${CHAIN - 1} files depend on it; the nearest 3 are listed, and ${CHAIN - 4} more counted\n`);
  });

  it('counts them all and lists none for a summary', async () => {
    const called = await tool('get_dependents', { paths: ['chain/c0.ts'], summary: true });
    const [result] = called.structuredContent?.['results'] as Array<{ dependents: unknown[]; truncated?: number }>;

    expect(result).toMatchObject({ dependents: [], truncated: CHAIN - 1 });
    expect(called.content[0]?.text).toContain(`  ${CHAIN - 1} files depend on it; none is listed, and ${CHAIN - 1} more counted\n`);
  });

  it('says one dependent in the singular, and lists one where max_files is 1', async () => {
    const one = await tool('get_dependents', { paths: [`chain/c${CHAIN - 2}.ts`], summary: true });
    expect(one.content[0]?.text).toContain('  1 file depends on it; none is listed, and 1 more counted\n');

    const [first] = (await tool('get_dependents', { paths: ['chain/c0.ts'], max_files: 1 })).structuredContent?.['results'] as Array<{ dependents: unknown[]; truncated?: number }>;
    expect(first).toMatchObject({ dependents: [expect.anything()], truncated: CHAIN - 2 });
    expect((await tool('get_dependents', { paths: ['chain/c0.ts'], max_files: 0 })).isError).toBe(true);
  });

  it('writes no truncated where every dependent is listed, and lists up to MAX_DEPENDENTS by default', async () => {
    const [result] = (await tool('get_dependents', { paths: ['chain/c0.ts'] })).structuredContent?.['results'] as Array<Record<string, unknown>>;
    const [exact] = (await tool('get_dependents', { paths: ['chain/c0.ts'], max_files: CHAIN - 1 })).structuredContent?.['results'] as Array<Record<string, unknown>>;

    expect(result).not.toHaveProperty('truncated');
    expect(exact).not.toHaveProperty('truncated');
    expect(MAX_DEPENDENTS).toBe(200);
  });
});

describe('get_architectural_rules', () => {
  it('answers several paths in turn', async () => {
    const called = await tool('get_architectural_rules', { paths: ['src/domain/order.ts', 'chain/c0.ts'] });
    const results = called.structuredContent?.['results'] as Array<{ path: string; rules: unknown[] }>;

    expect(results.map((result) => [result.path, result.rules.length])).toEqual([
      ['src/domain/order.ts', 1],
      ['chain/c0.ts', 0],
    ]);
  });
});

describe('check_architecture', () => {
  it('refuses a path that is not on disk or in contents, where it said the path passed', async () => {
    const called = await tool('check_architecture', { paths: ['src/domain/new.ts'] });

    expect(called).toMatchObject({ isError: true });
    expect(called.content[0]?.text).toBe('"src/domain/new.ts" is not on disk, so no rule can be checked for it: save it first, or pass its text in "contents".');
    const two = await tool('check_architecture', { paths: ['src/a.ts', 'src/domain/order.ts', 'src/b.ts'] });
    expect(two.content[0]?.text).toBe('"src/a.ts", "src/b.ts" are not on disk, so no rule can be checked for them: save them first, or pass their text in "contents".');
  });

  it('refuses contents that are not file paths to their text', async () => {
    for (const contents of [null, [], 'text', 1, { 'src/a.ts': 1 }, { 'src/a.ts': 'text', 'src/b.ts': null }]) {
      expect(await tool('check_architecture', { contents }), JSON.stringify(contents)).toEqual({
        content: [{ type: 'text', text: '"contents" must be an object of file paths to their text.' }],
        isError: true,
      });
    }
  });

  it('checks a file not yet saved from contents, and the rules that govern it alone', async () => {
    const called = await tool('check_architecture', { contents: { 'src/domain/new.ts': "import { db } from '../infra/db.js';\n" } });

    expect(called.structuredContent).toMatchObject({ ok: false, paths: ['src/domain/new.ts'], rules: { checked: 1, failed: 1 } });
    // Nothing was written.
    expect((await tool('check_architecture', { paths: ['src/domain/new.ts'] })).isError).toBe(true);
  });

  it('runs the rules a spec states when the spec is asked for by its path, unsaved too', async () => {
    const saved = await tool('check_architecture', { paths: ['docs/adr.md'] });
    expect(saved.structuredContent).toMatchObject({ ok: true, rules: { checked: 1 } });

    const drafted = await tool('check_architecture', {
      paths: ['docs/adr.md'],
      contents: { 'docs/adr.md': '# ADR\n\n<!-- @assert-absence target="src" symbol="db" -->\n' },
    });
    expect(drafted.structuredContent).toMatchObject({ ok: false, rules: { inForce: 1, checked: 1, failed: 1 } });
  });
});

describe('check_claims', () => {
  it('holds the configured claims to their evidence', async () => {
    const claimed = await makeTempRepo({ 'spec/a.md': '- `Implemented`: the order is stored.\n', 'docs/adr.md': '# ADR\n' });
    try {
      const handle = createMcpHandler({
        root: claimed,
        patterns: ['docs/**/*.md'],
        version: '9.9.9',
        claims: { files: ['spec/*.md'], labels: { Implemented: { evidence: 'test' } }, testPrefixes: ['fn test_'] },
      });
      const response = (await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "check_claims", arguments: {} } })) as unknown as { result: ToolResult };

      expect(response.result.structuredContent).toMatchObject({ ok: false, totals: { Implemented: 1 }, findings: [{ rule: 'unevidenced-claim', file: 'spec/a.md', line: 1 }] });
      expect(response.result.content[0]?.text).toContain('unevidenced-claim');
    } finally {
      await removeTempRepo(claimed);
    }
  });

  it('answers in plain ASCII, and says where a label stands in prose', async () => {
    const claimed = await makeTempRepo({ 'spec/a.md': '- `Implemented`: the order is stored.\n\nWhat is `Implemented` here is said above.\n', 'docs/adr.md': '# ADR\n' });
    try {
      const handle = createMcpHandler({ root: claimed, patterns: ['docs/**/*.md'], version: '9.9.9', claims: { files: ['spec/*.md'], labels: { Implemented: { evidence: 'test' } }, testPrefixes: ['fn test_'] } });
      const response = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_claims', arguments: {} } })) as unknown as { result: ToolResult };
      const text = response.result.content[0]!.text;
      const prose = (response.result.structuredContent?.['prose'] as Array<{ line: number }>)[0];

      expect(prose).toMatchObject({ line: 3 });
      expect(text).toMatch(/^[\x20-\x7e\n]*$/);
      expect(text).toContain('spec/a.md:3:');
    } finally {
      await removeTempRepo(claimed);
    }
  });

  it('is refused where no claims are configured, and takes no argument', async () => {
    expect(await tool('check_claims', {})).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^No claims are configured/) }] });
    expect(await tool('check_claims', { files: [] })).toMatchObject({ isError: true, content: [{ text: 'Unknown argument "files"; this tool takes no arguments.' }] });
  });
});
