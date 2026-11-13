/**
 * Imports that only a type checker reads.
 *
 * `types="ignore"` asks the runtime question, and two kinds of import were
 * still counted as runtime dependencies (round 29): TypeScript's import types,
 * `type T = import('./a').X` and `typeof import('./a')`, which kept a cycle
 * that the compiler erases; and Python's `if TYPE_CHECKING:` block, whose
 * imports Python never runs, where `types` did nothing at all.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { analyzeSource } from '../src/imports.js';
import { runSpecGuard } from '../src/runner.js';
import { memoryIo } from './helpers.js';

const ROOT = path.resolve('/virtual/type-imports');

const typeOnly = (source: string, file: string): Array<[string, boolean]> =>
  analyzeSource(source, file).references.map((reference) => [reference.specifier, reference.typeOnly]);

describe('an import type in TypeScript', () => {
  it('is a member of import(), or typeof import()', () => {
    expect(
      typeOnly("type T = import('./a').User;\nlet m: typeof import('./b');\nexport type U = import('./c').Page<Item>;\n", 'src/x.ts'),
    ).toEqual([
      ['./a', true],
      ['./b', true],
      ['./c', true],
    ]);
  });

  it('is in every TypeScript extension', () => {
    for (const file of ['src/x.mts', 'src/x.cts', 'src/x.tsx']) expect(typeOnly("type T = import('./a').X;\n", file)).toEqual([['./a', true]]);
  });

  it('is not a load: import() awaited, or with then, catch or finally called on it', () => {
    expect(
      typeOnly(
        "const a = await import('./a');\nimport('./b').then((m) => m);\nimport('./c').catch(() => null);\nimport('./d').finally(done);\nimport('./e');\n",
        'src/x.ts',
      ),
    ).toEqual([
      ['./a', false],
      ['./b', false],
      ['./c', false],
      ['./d', false],
      ['./e', false],
    ]);
  });

  it('is not read in JavaScript, where import() is always a load', () => {
    expect(typeOnly("const a = import('./a').X;\nconst b = typeof import('./b');\n", 'src/x.js')).toEqual([
      ['./a', false],
      ['./b', false],
    ]);
    // The extension decides, not `.ts` anywhere in the name.
    expect(typeOnly("const b = typeof import('./b');\n", 'src/gen.ts.js')).toEqual([['./b', false]]);
  });

  it('is a load at the very start of a file and at its very end', () => {
    expect(typeOnly("import('./a');\nexport const b = import('./b')", 'src/x.ts')).toEqual([
      ['./a', false],
      ['./b', false],
    ]);
  });

  it('leaves require() as it was', () => {
    expect(typeOnly("const a = require('./a').X;\n", 'src/x.ts')).toEqual([['./a', false]]);
  });
});

describe('an import in Python under if TYPE_CHECKING', () => {
  it('is type-only in the block, on the opening line after its colon, and under typing.TYPE_CHECKING', () => {
    const source = [
      'from typing import TYPE_CHECKING',
      'if TYPE_CHECKING:',
      '    from .models import User',
      '    import app.db',
      'if TYPE_CHECKING: import app.inline',
      'def f():',
      '    if typing.TYPE_CHECKING:',
      '        import app.nested',
      '    import app.after',
      '',
    ].join('\n');

    expect(typeOnly(source, 'src/x.py')).toEqual([
      ['typing', false],
      ['.models', true],
      ['app.db', true],
      ['app.inline', true],
      ['app.nested', true],
      ['app.after', false],
    ]);
  });

  it('runs after the block, in its else, and under if not TYPE_CHECKING', () => {
    const source = [
      'if TYPE_CHECKING:',
      '    import app.db',
      'else:',
      '    import app.runtime',
      'import os',
      'if not TYPE_CHECKING:',
      '    import app.no',
      'if TYPE_CHECKING or DEBUG:',
      '    import app.either',
      '',
    ].join('\n');

    expect(typeOnly(source, 'src/x.py')).toEqual([
      ['app.db', true],
      ['app.runtime', false],
      ['os', false],
      ['app.no', false],
      ['app.either', false],
    ]);
  });

  it('opens on if alone, with blanks where Python takes them, and an import right after the colon', () => {
    const source = [
      'if TYPE_CHECKING:import app.tight',
      'if\tTYPE_CHECKING :',
      '    import app.spaced',
      'if x:',
      '    pass',
      'elif TYPE_CHECKING:',
      '    import app.elif_branch',
      'if  TYPE_CHECKING:',
      '    import app.two_blanks',
      'if typing . TYPE_CHECKING:',
      '    import app.dotted',
      '',
    ].join('\n');

    expect(typeOnly(source, 'src/x.py')).toEqual([
      ['app.tight', true],
      ['app.spaced', true],
      ['app.elif_branch', false],
      ['app.two_blanks', true],
      ['app.dotted', true],
    ]);
  });

  it('keeps a block inside the block in it', () => {
    const source = ['if TYPE_CHECKING:', '    import app.a', '    if TYPE_CHECKING:', '        import app.b', '    import app.c', 'import os', ''].join('\n');

    expect(typeOnly(source, 'src/x.py')).toEqual([
      ['app.a', true],
      ['app.b', true],
      ['app.c', true],
      ['os', false],
    ]);
  });

  it('reads import() with a second argument and a member after it as a load', () => {
    expect(typeOnly("const a = import('./a', { with: { type: 'json' } });\n", 'src/x.ts')).toEqual([['./a', false]]);
  });

  it('measures a tab as Python does, to the next multiple of eight', () => {
    expect(typeOnly('if TYPE_CHECKING:\n\timport app.db\n        import app.same\nimport os\n', 'src/x.py')).toEqual([
      ['app.db', true],
      ['app.same', true],
      ['os', false],
    ]);
    // A form feed is one column, and a line indented with one is in the block.
    expect(typeOnly('if TYPE_CHECKING:\n\fimport app.db\n', 'src/x.py')).toEqual([['app.db', true]]);
    // A tab after spaces reaches the next multiple of eight: four and a tab
    // are eight, and one and a tab are eight too, which is back at `if b:`
    // and ends a block opened at nine spaces. Python takes both.
    expect(typeOnly('if TYPE_CHECKING:\n    \timport app.deep\n', 'src/x.py')).toEqual([['app.deep', true]]);
    expect(
      typeOnly('if a:\n \tif b:\n         if TYPE_CHECKING:\n             import app.typed\n \timport app.runs\n', 'src/x.py'),
    ).toEqual([
      ['app.typed', true],
      ['app.runs', false],
    ]);
  });

  it('keeps a comment line from ending the block', () => {
    expect(typeOnly('if TYPE_CHECKING:\n# a note\n    import app.db\n', 'src/x.py')).toEqual([['app.db', true]]);
  });
});

describe('types="ignore" over imports a type checker alone reads', () => {
  async function results(spec: string, files: Record<string, string>) {
    const report = await runSpecGuard({
      patterns: ['docs/adr.md'],
      root: ROOT,
      io: memoryIo(ROOT, { 'docs/adr.md': `# ADR\n\n${spec}\n`, ...files }),
      engine: 'javascript',
    });
    expect(report.errors).toEqual([]);
    return report.results;
  }

  it('finds no cycle through an import type, and the cycle with types counted', async () => {
    const files = { 'src/a.ts': "import { b } from './b';\nexport const a = b;\n", 'src/b.ts': "export type A = import('./a').A;\nexport const b = 1;\n" };
    const [ignored, counted] = await results('<!-- @assert-import-cycle target="src" types="ignore" -->\n<!-- @assert-import-cycle target="src" -->', files);

    expect(ignored!.ok).toBe(true);
    expect(counted!.ok).toBe(false);
  });

  it('leaves a Python TYPE_CHECKING import out of an import rule', async () => {
    const files = { 'app/domain/order.py': 'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from app.infra.db import Session\n' };
    const [ignored, counted] = await results(
      '<!-- @assert-import-absence module="app.infra" target="app/domain" types="ignore" -->\n<!-- @assert-import-absence module="app.infra" target="app/domain" -->',
      files,
    );

    expect(ignored!.ok).toBe(true);
    expect(counted!.ok).toBe(false);
  });
});
