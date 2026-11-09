# `@assert-structure` - what files are called, and what comes with them

Architecture documents state conventions over sets of files rather than naming
files one by one. Each directive makes exactly one of three claims:

```md
<!-- @assert-structure target="src/domain" exclude="*.test.ts" pattern="*.entity.ts, index.ts" -->
<!-- @assert-structure target="packages" dirs="*" required="package.json, README.md" -->
<!-- @assert-structure target="src/handlers" exclude="*.test.ts" partner="[name].test.ts" -->
```

- **`pattern`** - every file in scope is named by one of the patterns. They are
  globs, read like `glob=`: without a `/` against the file name, with one
  against the path from the root.
- **`required`** - every directory holds every entry. Without `dirs` the
  directories are the targets; `dirs="*"` means their immediate children and
  `dirs="**"` every directory below them. `dirs` names directories, so a
  trailing `/` there changes nothing, on the whole of it or on an alternative
  of its braces: `dirs="{api/,web}"` is `api` and `web`, where a spec
  pattern reads `api/` there as what `api` holds. An entry may be a path
  (`src/index.ts`), may end in a glob (`*.csproj`), and must be a directory
  when it ends in `/`.
- **`partner`** - every file has a partner, named by a template.

Each failure names the file or directory, since there is no line to point at:

```text
✖ docs/architecture.md:3  @assert-structure
    files in src/domain must be named *.entity.ts or index.ts (excluding *.test.ts)
    expected no misnamed files, found 1
      src/domain/helpers.ts  matches none of *.entity.ts, index.ts

✖ docs/architecture.md:4  @assert-structure
    directories matching * under packages must contain package.json, README.md
    expected no directories missing an entry, found 2
      packages/billing  missing README.md
      packages/web  missing package.json, README.md

✖ docs/architecture.md:5  @assert-structure
    files in src/handlers must each have a partner [name].test.ts (excluding *.test.ts)
    expected no files without a partner, found 1
      src/handlers/refund.ts  has no partner src/handlers/refund.test.ts
```

A partner template has three placeholders and nothing else - no regular
expressions, no conditionals - so a reader can expand one by eye:

| Placeholder | For `src/api/user.handler.ts`, `target="src"` |
| --- | --- |
| `[name]` | `user.handler` - the file name up to its last dot |
| `[ext]` | `ts` - what follows that dot |
| `[dir]` | `api` - the file's directory below the target, empty at the top |

A template without a `/` names a file beside it. One with a `/` is a path from
the root, which is how a mirrored test tree is written:
`partner="tests/[dir]/test_[name].py"`. A comma-separated list gives
alternatives, any one of which will do.

The partners themselves are in scope unless `exclude` says otherwise. Forgetting
to exclude them is loud rather than silent, and says what probably happened:

```text
      src/handlers/order.test.ts  has no partner src/handlers/order.test.test.ts (it is the partner of src/handlers/order.ts - exclude it?)
```

Some things fail rather than pass, because each is a rule that would otherwise
check nothing:
- a scope holding no files, or selecting no directories (`allow-empty` as
  everywhere else);
- a template that names the file itself (`partner="[name].[ext]"`);
- a `required` target that is a file.

**Names are compared exactly, on every platform.** Whether `README.md` exists is
decided by reading its directory, never by asking the filesystem for the path.
That lookup finds `Readme.md` on Windows and macOS and does not find it on Linux,
and the same rule would pass on a laptop and fail in CI.

A structure rule reads names, never contents. It walks with the run's usual
skips, follows no symbolic link, and counts the spec files - which every other
rule leaves out, and which a naming rule about `docs/adr` is about. `max`,
`baseline` and `ratchet` work as they do on `@assert-absence`, and a baseline
lists files or directories. `spec-guard query` shows what a rule asks of a file
that does not exist yet:

```text
src/handlers/invoice.ts (does not exist yet)
  1 rule from 1 document

  Architecture  (docs/architecture.md)
    :5 @assert-structure  files in src/handlers must each have a partner [name].test.ts (excluding *.test.ts)
      partner: src/handlers/invoice.test.ts
```

[ADR-0013](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0013-structure-assertions.md) has the design and what it
costs.
