# Import rules, layers and cycles

The rules about dependencies: which modules a scope may import, the order of
layers, and cycles. Each reads the import graph rather than the text, and
takes the [attributes](attributes.md) its row there names.

## `@assert-import-absence` / `@assert-import-count` - dependencies, not text

The rules architecture documents actually contain are usually about
dependencies, and a text search answers those badly in both directions - it
matches a mention in a comment, and it misses `export * from '../db'`.

```md
<!-- @assert-import-absence target="src/ui" module="src/db" reason="the UI talks to services, not storage" -->
<!-- @assert-import-count target="src" module="axios" max="1" -->
```

These read the dependency rather than the text, in **five languages**:

| Language | Extensions | Reads |
| --- | --- | --- |
| JavaScript / TypeScript | `.js .mjs .cjs .jsx .ts .mts .cts .tsx` | `import`, `export ... from`, `require()`, `import()` |
| Python | `.py .pyi` | `import a.b` and `from .rel import x` in every spelling Python's grammar takes, 3.15's `lazy import` among them, and `importlib.import_module("x")` |
| Go | `.go` | `import "x"` and grouped `import ( ... )`, including `.`, `_` and a package name as Go writes one, beyond ASCII too |
| Rust | `.rs` | `use a::{b, c}` with nested groups, `pub use` and `extern crate`, in every spelling rustc's grammar takes: white space and comments between the tokens, a raw identifier, `self` at the end of a path |
| C# | `.cs .csx` | `using`, `using static`, `global using`, `using X = A.B`, `global::` and extern-alias qualifiers, and a using relative to its namespace, in every spelling the C# grammar takes: white space and comments between the tokens, a name written with `@` or an escape, `using static unsafe` and a generic type, and each type an alias or a `using static` holds, its type arguments and the elements of a tuple among them |

No parser and no new dependency. JavaScript gets a full tokenizer because a
module reference can appear anywhere in an expression; the other four are read
by masking comments and string literals with the classifier from
[ADR-0006](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0006-comment-classification.md) and then reading statements
off what is left. Tree-sitter would have cost 94 MB unpacked against this
package's 0.33 MB - [ADR-0008](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0008-polyglot-imports.md) has the
measurements, and the list of things a real parser would genuinely see that
this does not.

Module patterns are matched against the resolved `/`-separated path *and*
against the specifier as written, so `module="System.Text.Json"` and
`module="System/Text/Json"` both work. Either form covers what sits beneath it,
as `module="lodash"` covers `lodash/fp`: `module="Shop.Application"` matches
`using Shop.Application.Catalog;` and not `using Shop.ApplicationServices;`,
`module="app.db"` matches `import app.db.client`, and `module="crate::db"`
matches `use crate::db::pool`. Matching is case-sensitive, so a rule spanning C#
and Go needs both conventions: `module="app/db/** App/Db/**"`.

The unit counted is **files** that depend on the module. For JavaScript and
TypeScript it understands:

| Form | Counted |
| --- | --- |
| `import { A } from 'x'`, `import 'x'`, `import * as ns from 'x'` | yes |
| `import type { A } from 'x'` | yes, unless `types="ignore"` |
| `export * from 'x'`, `export { A } from 'x'` | yes - a re-export is a dependency, and a barrel file is how layering rules usually get broken |
| `require('x')` | yes, with a literal argument |
| `import('x')` | yes, with a literal argument |
| `import(name)`, `require(expr)` | **no - reported, see below** |

Relative specifiers are resolved by path arithmetic, so `module="src/db"`
matches `../db/client.js` seen from `src/ui/`, and Python's `from ..core import
x` resolves against the importing file the same way. There is deliberately no
filesystem resolution: tsconfig `paths` aliases and package `exports` maps are
not followed, so an alias is written out as itself (`module="@app/db"`).

**It tells you what it could not see.** Roughly 1% of module references in real
code are dynamic, and about 0.09% of files defeat the tokenizer outright. Both
are reported rather than counted as clean:

```text
⚠ docs/adr.md:1  1 module reference could not be resolved statically
⚠ docs/adr.md:1    src/core/plugin.ts:1 import(name)

1 passed · 9ms
✔ every spec assertion holds
```

The count is still true of everything that could be seen; the warning is what
stops it being mistaken for a complete answer.
- **A passing rule prints it** without `--verbose` too, since a green run is
  when it would otherwise go unread.
- **`--strict` turns those warnings into failures.**
- **A statement that starts as an import and that its compiler refuses is
  one of them**: a Python statement Python refuses, `from a import b,`; a
  Rust use declaration or extern crate that rustc refuses in every
  edition, `use a::b c;` or `use a::fn;`; and a C# using directive the
  compiler refuses, `using A.;`. Each names no module, and the rule says so
  on its file and line. A `use` among a macro's tokens, or in a bound such
  as `impl Trait + use<'a>`, a C# using statement or declaration, and a
  directive in a section an `#if` may leave out start none.
- **Files in scope in a language whose imports spec-guard cannot read are
  counted and reported**, so a rule pointed at the wrong tree says "analysed 2
  of 3 files; 1 is in a language whose imports spec-guard cannot read (.razor)"
  rather than quietly passing - and if *none* of them can be read, the
  assertion fails rather than passing on an empty analysis. Under
  `--strict` such a file fails an import or layer rule, as a reference it
  could not resolve does: leave it out with `exclude`. A cycle rule claims
  nothing of a file outside its graph, and says it without failing.
- **A file that can hold no import is in neither count**: JSON in any of its
  spellings (`.json`, `.jsonc`, `.json5`, `.jsonl`, `.ndjson`), `.csv`, `.tsv`,
  `.txt`, `.svg`, and anything binary, a NUL in its bytes, as an image or a
  font has. YAML, XML, Markdown and CSS are reported, since each has a form
  that takes in another file. A dependency a `package.json` names is a text
  rule's, as a `<ProjectReference>` is.

[ADR-0005](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0005-import-assertions.md) has the measurements and the
reasoning behind each boundary.

## `@assert-layers` - dependencies point one way

"Domain must not depend on infrastructure" across three layers is three
import rules, and across five it is ten - a triangle nobody writes down, and
the row somebody forgets when a layer is added. One directive states the order:

```md
<!-- @assert-layers target="src" order="src/domain, src/application, src/infrastructure" -->
```

**Order runs from the layer everything may depend on to the layer that may
depend on everything.** A file may import from its own layer and from any layer
listed before it; importing from a layer listed after it is a violation, and
the report says which way it went:

```text
✖ docs/architecture.md:12  @assert-layers
    src must keep its layers in order, src/domain < src/application < src/infrastructure
    expected no violating files, found 1
      src/domain/user.ts:3:1  src/domain -> src/infrastructure: import ../infrastructure/db.js
```

A layer is a pattern in the same language as `module=` and `exclude`, which is
why this works in all five languages above: `src/domain` is anchored at the
root, and a bare `domain` matches that segment anywhere - in `src/domain/user.ts`,
in Python's `app.domain.user`, in Rust's `crate::domain::user`. A layer may also
be a single file; `order="src/parser.ts, src/cli.ts"` understands that
`./parser.js` is `src/parser.ts`. C# is layered by namespace, and has
[a section of its own](#c-and-net-solutions).

The unit is files, and `max`, `types`, `exclude` and `baseline` mean what they
mean on `@assert-import-absence`. Five things fail rather than pass, because
each is a rule that would otherwise check less than it says:

- a layer that matches no file (`order="domain, aplication"`);
- a file two layers both claim;
- a target that does not exist;
- a layer no C# `using` can reach, because it matches none of the namespaces its
  own files declare - `src/Shop.Application` rather than `Shop.Application`;
- a scope in which no import reaches a layer other than its own file's, since
  that rule passes whatever order its layers are listed in:

```text
✖ docs/architecture.md:12  @assert-layers
    src must keep its layers in order, src/domain < src/application < src/infrastructure
    no import in scope reaches a layer other than its own file's, so these layers would pass in any order (add allow-empty="true" if that is expected)
```

`allow-empty="true"` turns the first and the last two into warnings. Files that
no layer claims are left alone and counted, so a directory nobody assigned shows
up as a number rather than as silence.

## C# and .NET solutions

A .NET project has three names: its folder, its project file and its root
namespace. `dotnet new` gives all three the same one, and that is what lets a
single pattern do both halves of a layer rule - hold the files under
`src/Shop.Domain`, and reach `using Shop.Domain.Orders;` from anywhere else:

```md
<!-- @assert-layers target="src" order="Shop.Domain, Shop.Application, Shop.Infrastructure, Shop.Web" reason="dependencies point inward" -->
<!-- @assert-import-absence target="src/Shop.Application" module="Microsoft.EntityFrameworkCore" reason="persistence is infrastructure's" -->
```

- **Name a C# layer by its namespace.** `Shop.Domain` matches the folder as a
  path segment, and the namespace with everything under it - `Shop.Domain.Orders`,
  but not `Shop.DomainEvents`. A folder path such as `src/Shop.Domain` holds the
  right files, but a using names a namespace, never a path, so nothing can reach
  it: such a rule fails, and names a namespace the layer's files declare. Where
  folders and namespaces differ, as when `src/Domain` holds
  `Acme.Clean.Domain.Entities`, the name they share - `Domain` - does both.
- **`module=` is a namespace too**, as above: `module="Shop.Infrastructure"`
  covers `using Shop.Infrastructure.Persistence;`.
- **What is read**: `using`, `global using`, `using static` and aliases, with
  any `global::` or extern-alias qualifier left off the name, and each type
  an alias or a `using static` holds: `using Pool =
  Dictionary<Shop.Db.Key, int>;` names `Dictionary` and `Shop.Db.Key`, and
  `using T = int;` names nothing. A using inside a namespace may be relative
  to it, so `using Application.Orders;` inside `namespace Shop.Domain` also
  counts as `Shop.Application.Orders`. Nothing in a comment, a verbatim
  string or a raw string literal is read.

What it cannot see, and the text rule that covers each - a text rule reads a
name wherever it is written:

| Not seen by an import rule | Held by |
| --- | --- |
| A fully qualified name with no using: `new Shop.Infrastructure.Db()` | `@assert-absence target="src/Shop.Domain" glob="*.cs" symbol="Shop.Infrastructure" word="true"` |
| A `<ProjectReference>`, or a `<Using Include>` in a project file | the same rule with `glob="*.csproj,*.props"` |
| `@using` in `.razor` and `.cshtml`, which import rules count as files they could not read | the same rule with `glob="*.razor,*.cshtml"` |
| Code a source generator writes | nothing: it is not in the tree |

In a solution of projects, the project references are the layering the
compiler enforces - a using of a project that is not referenced does not build -
so a rule over the project files is worth having beside the layer rule:

```md
<!-- @assert-absence target="src/Shop.Domain" glob="*.csproj" regex="true" symbol="Shop\.(Application|Infrastructure|Web)\b" reason="the domain references no outer project" -->
```

Keep build output out of every rule in `.spec-guard.json`:

```json
{
  "specs": ["docs/**/*.md"],
  "exclude": ["bin", "obj", "artifacts", "TestResults", ".vs"]
}
```

`bin` and `obj` are MSBuild's output, `artifacts` is where the output goes with
`UseArtifactsOutput` (.NET 8 and later), `TestResults` is where `dotnet test`
writes, and `.vs` holds Visual Studio's caches. A front end in the same tree
adds its own, such as Nuxt's `.output`; `node_modules` is skipped already.

## `@assert-import-cycle` - no file depends on itself

```md
<!-- @assert-import-cycle target="src" types="ignore" -->
```

A cycle is reported as one concrete loop, with the line of every import on it:

```text
✖ docs/architecture.md:20  @assert-import-cycle
    src must have no import cycles (type-only imports ignored)
    expected no import cycles, found 1
      src/orders/cart.ts:4:1  src/orders/cart.ts:4 -> src/billing/invoice.ts:2 -> src/orders/cart.ts
```

The count is **knots, not loops**: a set of files each reachable from the others
counts once however many routes run around it, so adding an import inside a
tangle that already exists does not move the number. `max="2"` adopts the rule
on a codebase that already has two, and fails on the third.

`types="ignore"` asks the runtime question - erased imports create no load-order
cycle - and the default asks the coupling one. This repository needs both: its
`src/` has exactly one cycle, and it is type-only.

`dynamic="ignore"` asks it about `import()` too. A plugin that `configuration.ts`
loads with `import('./tier-boot.ts')` can import `configuration.ts` back without
any module waiting on another to load, so a loop closed only by `import()` is
left out. A static import between the same two files keeps the loop. The one
case this lets through is a **top-level `await import()`**, which does run while
its module loads and can deadlock a cycle. It looks the same to a tokenizer as
an `await import()` inside a function, so ignoring dynamic imports ignores both.
`require()` always counts: whether it runs at load depends on where it is
called.

**Cycles are JavaScript and TypeScript only**, because a cycle needs to know that
`./b.js` *is* `src/b.ts`, and in the other four languages an import names a
module, package or namespace rather than a file. A scope with no JavaScript or
TypeScript in it fails instead of reporting no cycles. The resolver is a short,
fixed table - the TypeScript source of an emitted `.js`, the path as written,
the path with each extension, the directory's `index` - checked against files
the walk already found, never against the disk.

It says what it could not follow. An import that should have become an edge and
did not - a relative path matching no file, or an alias like `@/db` or
`#internal/db` that cannot be a package - is reported, and fails the run under
`--strict`. An alias spelled like a real package, `@app/db` through `tsconfig`
paths, is the one thing it cannot see and cannot report: that would mean
reading `tsconfig.json`, which is the resolver
[ADR-0011](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0011-layers-and-cycles.md) declines to become, for the
reasons it gives.
