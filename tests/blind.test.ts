/**
 * The import rules that passed over what they never looked at.
 *
 * Round 29 found two: a TypeScript path alias, which the rules do not resolve
 * (ADR-0005), and a pattern written as a path into the tree held to files that
 * import by module name - a Python package in a src layout, a Go module path,
 * Rust's `crate::`, a C# namespace. Each passed `--strict` while checking
 * nothing. Each is now said beside the rule, as a warning that fails nothing
 * (spec-core's ADR-0009 holds a new failure until the format freeze ends),
 * and each pattern written right stays quiet.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { leadingFolder } from '../src/blind.js';
import { formatGithub, formatJson, formatSarif, runAnnotations } from '../src/reporter.js';
import { runSpecGuard } from '../src/runner.js';
import type { AssertionResult } from '../src/types.js';
import { memoryIo } from './helpers.js';

const ROOT = path.resolve('/virtual/blind-imports');

async function results(directives: readonly string[], files: Record<string, string>, strict = true): Promise<AssertionResult[]> {
  const tree = { 'docs/adr.md': ['# ADR', '', ...directives, ''].join('\n'), ...files };
  const report = await runSpecGuard({ patterns: ['docs/adr.md'], root: ROOT, io: memoryIo(ROOT, tree), strictTargets: strict, engine: 'javascript' });
  expect(report.errors).toEqual([]);
  return report.results;
}

const ALIASED = {
  'src/db/client.ts': "import { order } from '../domain/order';\nexport const client = order;\n",
  'src/domain/order.ts': "import { client } from '@/db/client';\nexport const order = client;\n",
};

describe('a path alias', () => {
  it('is said beside an import rule it passed, and fails nothing under --strict', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/db/**" target="src/domain" -->'], ALIASED);

    expect(result!.ok).toBe(true);
    expect(result!.blindSpots).toEqual([
      {
        rule: 'unresolved-alias',
        message: '1 import is written as a path alias, which spec-guard does not resolve, and it reaches no pattern of this rule, so where it leads was not checked',
        hint: 'name the alias as it is written as well, as "@/db/**" does, or import by a relative path',
        at: ['src/domain/order.ts:1 @/db/client'],
      },
    ]);
    expect(result!.warnings).toContain('  src/domain/order.ts:1 @/db/client');
  });

  it('is said beside a layer rule it passed', async () => {
    const [result] = await results(['<!-- @assert-layers order="src/domain/**, src/db/**" target="src" -->'], ALIASED);

    expect(result!.ok).toBe(true);
    expect(result!.blindSpots?.map((spot) => [spot.rule, spot.at])).toEqual([['unresolved-alias', ['src/domain/order.ts:1 @/db/client']]]);
    expect(result!.blindSpots?.[0]?.message).toContain('reaches no layer of this rule');
    expect(result!.blindSpots?.[0]?.hint).toBe('write the layer to match the alias as well, as "**/db/**" does, or import by a relative path');
  });

  it('is not one when the rule names it as written: the dependency is then seen, and fails the rule', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/db/**, @/db/**" target="src/domain" -->'], ALIASED);

    expect(result!.ok).toBe(false);
    expect(result!.blindSpots).toBeUndefined();
  });

  it('is not one in a file the rule already counts', async () => {
    const [result] = await results(['<!-- @assert-import-count module="src/db/**" target="src" expected="1" -->'], {
      'src/db/x.ts': 'export {};\n',
      'src/a.ts': "import './db/x';\nimport '@/ui/button';\n",
    });

    expect(result!.ok).toBe(true);
    expect(result!.blindSpots).toBeUndefined();
  });

  it('is not one when it reaches a layer by the name it is written with', async () => {
    const [result] = await results(['<!-- @assert-layers order="**/domain/**, **/db/**" target="src" -->'], ALIASED);

    expect(result!.ok).toBe(false);
    expect(result!.blindSpots).toBeUndefined();
  });

  it('is left out with its type import when the rule leaves types out', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/db/**" target="src/domain" types="ignore" -->'], {
      'src/domain/order.ts': "import type { Client } from '@/db/client';\nexport type Order = Client;\n",
    });

    expect(result!.ok).toBe(true);
    expect(result!.blindSpots).toBeUndefined();
  });

  it('is a name no package could have, and a package is not one', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/db/**" target="src" -->'], {
      'src/a.ts': "import '@scope/pkg';\nimport 'lodash';\nimport '~/lib';\nimport '#internal/x';\n",
    });

    expect(result!.blindSpots?.[0]?.at).toEqual(['src/a.ts:3 ~/lib', 'src/a.ts:4 #internal/x']);
    expect(result!.blindSpots?.[0]?.message).toMatch(/^2 imports are written as a path alias/);
    expect(result!.blindSpots?.[0]?.hint).toBe('name the alias as it is written as well, as "~/lib/**" does, or import by a relative path');
  });

  it('of one segment has no folder to name, so the hint is the relative path', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/db/**" target="src" -->'], { 'src/a.ts': "import '#db';\n" });

    expect(result!.blindSpots?.[0]?.hint).toBe('import by a relative path, which the rule resolves');
  });

  it('is listed only as far as the run shows matches', async () => {
    const tree = {
      'docs/adr.md': '# ADR\n\n<!-- @assert-import-absence module="src/db/**" target="src" -->\n',
      'src/a.ts': "import '@/a';\nimport '@/b';\nimport '@/c';\n",
    };
    const report = await runSpecGuard({ patterns: ['docs/adr.md'], root: ROOT, io: memoryIo(ROOT, tree), maxSnippets: 2, engine: 'javascript' });

    expect(report.results[0]!.blindSpots?.[0]?.at).toEqual(['src/a.ts:1 @/a', 'src/a.ts:2 @/b']);
    expect(report.results[0]!.blindSpots?.[0]?.message).toMatch(/^3 imports/);
  });

  it('is never read off a language whose imports are not files', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/db/**" target="src" -->'], {
      'src/a.py': 'import os\n',
      'src/b.ts': "import './c';\n",
      'src/c.ts': 'export {};\n',
    });

    expect(result!.blindSpots).toBeUndefined();
  });
});

describe('a pattern on a path, held to files that import by module name', () => {
  it('is said for a Python src layout, with the module as it is imported', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/shop/infra/**" target="src/shop/domain" -->'], {
      'src/shop/__init__.py': '',
      'src/shop/infra/db.py': 'x = 1\n',
      'src/shop/domain/order.py': 'import os\nfrom shop.infra.db import x\n',
    });

    expect(result!.ok).toBe(true);
    expect(result!.blindSpots).toEqual([
      {
        rule: 'module-path-pattern',
        message:
          'module pattern "src/shop/infra/**" names Python code by its path from src/, and the 1 Python file in scope imports by a module name that never starts there, such as "shop.infra.db", so it matches none of its imports',
        hint: 'a Python import names a module from its import root, which a src layout\'s folder is not part of: write the module as it is imported, such as "shop.infra" if src is that root',
        at: [],
      },
    ]);
  });

  it('is not said of a folder that is a Python package, whose path is its module name', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="shop/infra/**" target="shop/domain" -->'], {
      'shop/__init__.py': '',
      'shop/infra/db.py': 'x = 1\n',
      'shop/domain/order.py': 'import os\n',
    });

    expect(result!.blindSpots).toBeUndefined();
  });

  it('is not said when an import of the language does start at the folder', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="app/infra/**" target="app/domain" -->'], {
      'app/infra/db.py': 'x = 1\n',
      'app/domain/order.py': 'import app.domain.money\n',
    });

    expect(result!.blindSpots).toBeUndefined();
  });

  it('is not said when the pattern matched an import of the language', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/shop/infra" target="src/shop/domain" max="1" -->'], {
      'src/shop/infra/db.py': 'x = 1\n',
      'src/shop/domain/order.py': 'import os\nfrom ..infra import db\n',
    });

    expect(result!.actual).toBe(1);
    expect(result!.blindSpots).toBeUndefined();
  });

  it('is not said where the files make no import that names a module from somewhere', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/shop/infra/**" target="src/shop/domain" -->'], {
      'src/shop/infra/db.py': 'x = 1\n',
      'src/shop/domain/order.py': 'from . import money\n',
    });

    expect(result!.blindSpots).toBeUndefined();
  });

  it('is said for Go, which names a package by its module path, and not for **/ or the standard library', async () => {
    const files = { 'internal/infra/db.go': 'package infra\n', 'internal/domain/order.go': 'package domain\nimport (\n  "fmt"\n  "github.com/acme/shop/internal/infra"\n)\n' };
    const [wrong, anywhere, standard] = await results(
      [
        '<!-- @assert-import-absence module="internal/infra/**" target="internal/domain" -->',
        '<!-- @assert-import-absence module="**/internal/infra" target="internal/domain" max="1" -->',
        '<!-- @assert-import-absence module="net/http" target="internal/domain" -->',
      ],
      files,
    );

    expect(wrong!.blindSpots?.[0]?.message).toContain('such as "github.com/acme/shop/internal/infra"');
    expect(wrong!.blindSpots?.[0]?.hint).toBe(
      'a Go import names a package by its module path: start the pattern with **/, as "**/internal/infra", or write the module path in full',
    );
    expect(anywhere!.actual).toBe(1);
    expect(anywhere!.blindSpots).toBeUndefined();
    expect(standard!.blindSpots).toBeUndefined();
  });

  it('is said for Rust, with the module from crate::', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="rs/src/infra/**" target="rs/src/domain" -->'], {
      'rs/src/infra.rs': 'pub mod db;\n',
      'rs/src/domain/mod.rs': 'use crate::infra::db;\n',
    });

    expect(result!.blindSpots?.[0]?.hint).toBe('Rust names a crate\'s own modules from crate::: write "crate::infra"');
  });

  it('is said for C# beside an import rule, where a using names a namespace', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/Shop.Infra/**" target="src/Shop.Domain" -->'], {
      'src/Shop.Infra/Db.cs': 'namespace Shop.Infra { class Db {} }\n',
      'src/Shop.Domain/Order.cs': 'using System;\nusing Shop.Infra;\nnamespace Shop.Domain { class Order {} }\n',
    });

    expect(result!.blindSpots?.[0]?.message).toContain('such as "Shop.Infra"');
    expect(result!.blindSpots?.[0]?.hint).toBe('a C# using names a namespace, never a folder: write the namespace as a using names it');
  });

  it('is said once for every layer in the folder, and fails nothing the layer rule did not fail already', async () => {
    const [result] = await results(['<!-- @assert-layers order="src/shop/domain/**, src/shop/infra/**" target="src" allow-empty="true" -->'], {
      'src/shop/infra/db.py': 'from shop.domain.order import Order\n',
      'src/shop/domain/order.py': 'from shop.infra.db import x\n',
    });

    expect(result!.ok).toBe(true);
    expect(result!.blindSpots?.map((spot) => spot.message)).toEqual([
      'layers "src/shop/domain/**" and "src/shop/infra/**" name Python code by its path from src/, and the 2 Python files in scope import by a module name that never starts there, such as "shop.domain.order", so they match none of their imports',
    ]);
  });

  it('is not said where the path holds no code of the language: a Python script beside TypeScript', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/db/**" target="src" -->'], {
      'src/db/client.ts': 'export {};\n',
      'src/tools/gen.py': 'import os\n',
    });

    expect(result!.blindSpots).toBeUndefined();
  });

  it('is said where the path is a file of the language', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/infra" target="src/domain" -->'], {
      'src/infra.py': 'x = 1\n',
      'src/domain/order.py': 'import infra\n',
    });

    expect(result!.blindSpots?.[0]?.rule).toBe('module-path-pattern');
  });

  it('finds the code of the language two folders below the path', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="internal/infra" target="cmd" -->'], {
      'internal/infra/store/sql/db.go': 'package sql\n',
      'cmd/main.go': 'package main\nimport "github.com/acme/shop/internal/infra/store/sql"\n',
    });

    expect(result!.blindSpots?.[0]?.rule).toBe('module-path-pattern');
  });

  it('names no module for Python when the pattern has none after its folder, nor for Rust outside src', async () => {
    const [python, rust] = await results(
      ['<!-- @assert-import-absence module="lib/**" target="app" -->', '<!-- @assert-import-absence module="crates/infra/**" target="app" -->'],
      {
        'lib/db.py': 'x = 1\n',
        'crates/infra/lib.rs': 'pub fn x() {}\n',
        'app/main.py': 'import db\n',
        'app/main.rs': 'use infra::x;\n',
      },
    );

    expect(python!.blindSpots?.[0]?.hint).toBe(
      "a Python import names a module from its import root, which a src layout's folder is not part of: write the module as it is imported",
    );
    expect(rust!.blindSpots?.[0]?.hint).toBe("Rust names a crate's own modules from crate::");
  });

  it('reads a Rust self:: or super:: import as relative, which says nothing of the folder', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="src/infra/**" target="src/domain" -->'], {
      'src/infra/mod.rs': 'pub fn x() {}\n',
      'src/domain/mod.rs': 'use self::order::Order;\nuse super::infra::x;\n',
    });

    expect(result!.blindSpots).toBeUndefined();
  });

  it('is not said of a pattern that names no folder', async () => {
    const [result] = await results(['<!-- @assert-import-absence module="infra" target="src/shop/domain" -->'], {
      'src/shop/domain/order.py': 'import os\n',
    });

    expect(result!.blindSpots).toBeUndefined();
  });
});

describe('the folder a pattern starts at', () => {
  it('is its first segment when that is a name and more follows', () => {
    expect(leadingFolder('src/shop/**')).toBe('src');
    expect(leadingFolder('./src/x')).toBe('src');
    expect(leadingFolder('/src/x')).toBe('src');
  });

  it('is none for one segment, a glob, or a trailing slash alone', () => {
    expect(leadingFolder('src')).toBeNull();
    expect(leadingFolder('src/')).toBeNull();
    expect(leadingFolder('**/infra/**')).toBeNull();
    expect(leadingFolder('{src,lib}/x')).toBeNull();
    expect(leadingFolder('!src/x')).toBeNull();
    expect(leadingFolder('s?c/x')).toBeNull();
  });
});

describe('what a format says of a blind spot', () => {
  async function report() {
    const tree = { 'docs/adr.md': '# ADR\n\n<!-- @assert-import-absence module="src/db/**" target="src/domain" -->\n', ...ALIASED };
    return runSpecGuard({ patterns: ['docs/adr.md'], root: ROOT, io: memoryIo(ROOT, tree), engine: 'javascript' });
  }

  it('is a warning on the directive of a rule that passed', async () => {
    const annotations = runAnnotations(await report());

    expect(annotations).toEqual([
      expect.objectContaining({ rule: 'unresolved-alias', level: 'warning', severity: 'minor', file: 'docs/adr.md', line: 3 }),
    ]);
    expect(formatGithub(annotations)).toMatch(/^::warning file=docs\/adr.md,line=3,title=unresolved-alias::/);
  });

  it('is in the JSON document only where there is one', async () => {
    const [result] = JSON.parse(formatJson(await report())).results as Array<{ blindSpots?: unknown[] }>;
    expect(result!.blindSpots).toHaveLength(1);

    const clean = await runSpecGuard({
      patterns: ['docs/adr.md'],
      root: ROOT,
      io: memoryIo(ROOT, { 'docs/adr.md': '# ADR\n\n<!-- @assert-import-absence module="src/db/**" target="src" -->\n', 'src/a.ts': "import './b';\n", 'src/b.ts': '' }),
      engine: 'javascript',
    });
    expect(JSON.parse(formatJson(clean)).results[0]).not.toHaveProperty('blindSpots');
  });

  it('is a warning notification in SARIF, not an alert', async () => {
    const sarif = JSON.parse(formatSarif(await report())) as {
      runs: Array<{ results: unknown[]; invocations?: Array<{ toolExecutionNotifications: Array<{ level: string; message: { text: string } }> }> }>;
    };

    expect(sarif.runs[0]!.results).toEqual([]);
    expect(sarif.runs[0]!.invocations?.[0]?.toolExecutionNotifications).toEqual([
      { level: 'warning', message: { text: expect.stringMatching(/^docs\/adr\.md:3 1 import is written as a path alias/) } },
    ]);
  });
});
