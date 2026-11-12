# Attributes

What each attribute of a [directive](directives.md) means, and the ones that
need more than a row: [`exclude`](#exclude---everywhere-except),
[`comments`](#comments---the-note-about-a-deletion-is-not-the-deletion),
[`allow-empty`](#allow-empty---an-assertion-that-covers-nothing-is-a-failure)
and [`baseline`](#baseline---adopting-a-rule-the-codebase-already-breaks).
A `regex` is read in one dialect, on a page of its own:
[regular expressions](regex.md).

| Attribute | Applies to | Meaning |
| --- | --- | --- |
| `target` | all but present | Comma-separated paths, relative to `--root`. Default `.` |
| `symbol` | absence, count | The literal string to search for (or a regex with `regex="true"`) |
| `file` | present | Comma-separated paths that must exist |
| `expected` | all but present | Exact count for count; an upper bound everywhere else |
| `min` / `max` | count (`max` on all but present) | Inclusive bounds |
| `glob` | absence, count, structure | Include-only file filters, e.g. `*.ts,*.tsx` (ripgrep `-g` semantics) |
| `exclude` | all but present | Paths to leave out, gitignore-style: `src/config/**`, `tests`, `*.test.ts` |
| `regex` | absence, count | Treat `symbol` as a regular expression, written as JavaScript's and read as ripgrep reads it, where `^` and `$` match at each line's start and end ([regular expressions](regex.md)) |
| `word` | absence, count | Require word boundaries, so `Primary` does not match `PrimaryButton`: no word character, ripgrep's `\w`, just before the match or just after it |
| `ignore-case` | absence, count | Case-insensitive matching |
| `comments` | absence, count | `ignore` (default) or `include` for matches inside comments |
| `module` | import-absence, import-count | Which dependency, matched like `exclude` |
| `order` | layers | The layers, from the one everything may depend on to the one that may depend on everything |
| `pattern` | structure | The names every file in scope must match one of |
| `required` | structure | The entries every chosen directory must hold; a trailing `/` means a directory |
| `dirs` | structure, with `required` | Which directories below each target: `*` for children, `**` for all; a trailing `/` changes nothing, in braces or out |
| `partner` | structure | Partner templates, any one of which must exist: `[name].test.[ext]` |
| `types` | import assertions, layers, cycles | `include` (default) or `ignore` for what only a type checker reads: `import type`, TypeScript's import types (`import('./a').X`, `typeof import('./a')`), and Python's `if TYPE_CHECKING:` block |
| `dynamic` | cycles | `include` (default) or `ignore` for `import('x')` |
| `allow-empty` | all but present | Tolerate a scope that holds no files, a layer that matches none, a layer no C# using can reach, layers no import crosses between, or no chosen directories. Off by default - see below |
| `baseline` | absence, import-absence, layers, structure | Known violations that do not count: `path` or `path:count` |
| `ratchet` | absence, import-absence, layers, structure | `two-sided` (default) or `one-way` - see below |
| `reason` | all | Human-readable justification, printed on failure |

Unknown attributes are an error, not a shrug: `expct="1"` fails the run instead
of silently asserting nothing. A spec tool whose typos assert nothing is worse
than no spec tool.

## `exclude` - everywhere except

Most real rules are "nowhere except one place", not "not here":

```md
<!-- @assert-absence target="src" symbol="process.env" exclude="src/config/**" -->
```

That is one of the claims the README opens with - *no secret is ever read
from `process.env` outside `src/config`*
([why this exists](../../README.md#why-this-exists)) - written as one
assertion instead of a hand-maintained list of every directory that is not
`src/config`.

`exclude` follows gitignore rules, which are **not** the same as `glob`'s:

| Pattern | Excludes |
| --- | --- |
| `tests` | any directory or file named `tests`, at any depth, and everything under it |
| `/tests` | only the `tests` at the root, and everything under it |
| `src/config` | that directory and everything under it |
| `src/config/**` | the same, written explicitly |
| `*.test.ts` | any file with that name shape, at any depth |

The difference is deliberate. `glob="*.ts"` filters files, so basename matching
is what you want; `exclude="tests"` means the directory, because that is what
people mean when they write it - and it is what `rg -g '!tests'` does. Both
engines implement the same rule, and a parity matrix asserts they agree on it.

A leading `./`, with the slashes after it, and a trailing `/` are dropped, so
`./tests`, `.//tests` and `tests/` are `tests`, and a backslash is a separator. Four shapes are refused, because they
can never exclude anything:
- **`!`**, which in `.gitignore` re-includes a path. Pasted from one, it was
  silently dropped and the exclusion left wider than it read.
- **`..`**, since nothing outside the root is searched.
- **a drive path** such as `C:/repo/dist`.
- **`.` or `/`**, the root itself.

So is any pattern the glob engine cannot read - an unclosed `[` or `{`, an
extended glob such as `+(a|b)`, a range that runs backwards, `**` inside a
name, one too large to compile - rather than being read as a literal that
excludes nothing. The same goes for `glob`, `module`, `order` and the
structure rules' patterns, and for a spec pattern.

`**` means any number of directories only as a whole segment. `docs/**.md` is
refused, with the two ways to say what was meant, written from the pattern:
`docs/**/*.md` for any depth, `docs/*.md` for one level. For any depth the
stars become a segment of their own, with a star kept on each side where the
name went on; for one level they become one star: `src/a**` is told
`src/a*/**` or `src/a*`. The tools it could have come from read it three ways,
and a spec pattern read the narrow way drops every nested document without a
word.

In a directive a refused pattern is an invalid directive, whether or not its
document is in force; in the configuration's `specs` or `exclude`, a spec
pattern on the command line or `--spec`, or `--exclude`, it is exit 2.

List attributes accept commas or whitespace, so both of these work:

```md
<!-- @assert-absence target="src" symbol="TODO" exclude="src/legacy/** tests" -->
<!-- @assert-absence target="src" symbol="TODO" exclude="src/legacy/**,tests" -->
```

Two things therefore cannot be written in an attribute:
- **A path containing a space**: there is no quoting inside an attribute value.
- **A brace group with a comma in it**: `glob="*.{ts,tsx}"` is the two patterns
  `*.{ts` and `tsx}`, and is refused with a message that says so. Write
  `glob="*.ts, *.tsx"`.

A configuration's `exclude` and `specs` are JSON arrays, where a brace group
keeps its commas. Inside one, an alternative reads as it would written alone:
- **A trailing `/`** means what it means on a whole pattern: `{build/,dist}` in
  `exclude` is both directories and what they hold, and `{docs/,README.md}` in
  `specs` is everything under `docs`, and the README.
- **A leading `/`** anchors it at the root, as it anchors a whole pattern:
  `{/build,dist}` in `exclude` is the `build` at the root, and every `dist`.
  After a `./` it anchors nothing, as in `.//build`: `./{/build,dist}` is
  every `build`.
- **An alternative that names no path is refused**: `{./,docs}` in `specs` is
  exit 2, `the braces expand to "./", which names no path`.

## `comments` - the note about a deletion is not the deletion

You delete a symbol and leave the explanation where the next person will look:

```ts
// LegacyThing was removed in ADR-398; do not reintroduce it.
```

A plain text search reads that comment as an occurrence, so the assertion that
keeps the symbol deleted fails on the sentence proving it was deleted. Both
fixes are bad: delete the note and lose the reason, or delete the rule.

So matches inside comments do not count:

```md
<!-- comments are ignored by default -->
<!-- @assert-absence target="src" symbol="LegacyThing" -->

<!-- ...unless you ask for them -->
<!-- @assert-absence target="src" symbol="Copyright" comments="include" -->
```

`comments="include"` is right for assertions that really are about text — a
licence header, or a name that must appear nowhere in the repository at all.

Because this is the one thing that can turn a failing run green without anyone
touching code, a run that passed this way says so:

```
⚠ 1 match inside comments was not counted; add comments="include" to count it

1 passed · 7ms
✔ every spec assertion holds
```

Comment syntax is known for around 100 extensions across 11 families (JS/TS, C,
C#, Rust, Go, Python-style `#`, shell `#`, YAML, SQL-style `--`, markup -
MSBuild project files included - and formats with no comments at all), for
files known by their whole names (`Dockerfile`, `Makefile`, `Gemfile`,
`CMakeLists.txt` and the like), and for a script with no extension, by the
program its `#!` line runs (`sh`, `bash`, `python`, `node`, `ruby` and the
like). What would hide real code if misread is tracked too:
- **Strings**, because `//` inside a URL is not a comment.
- **JavaScript's regular expressions**, because the quote in `/["']/` is not a
  quote.
- **What only looks like either**: a Rust lifetime (`&'static str`), a C++ digit
  separator (`100'000`), a `#` inside a shell word (`${#items[@]}`), an
  apostrophe in a YAML value (`name: it's fine`) and a `/*` in JSX text
  (`<div>/*</div>`) all open nothing.

Where spec-guard is unsure — an unknown extension, an unterminated literal — the
text counts as code, and the report says which files it could not classify. A
match wrongly kept is a visible failure you can argue with; a match wrongly
dropped is a lie.

A `min` is the exception: a comment counted as code satisfies a rule that needs
a match. So a project names what the table does not know, in its
[configuration](configuration.md):

```json
{ "comments": { ".dsl": "c-like", "LICENSE-MIT": "none" } }
```

- A key is an extension, a dot and one segment read in any case, or a whole
  file name, which is how a file with no extension is named.
- A value is one of the profiles: `javascript`, `c-like`, `c#`, `rust`, `go`,
  `hash`, `shell`, `yaml`, `sql-like`, `markup` or `none`.
- A file name comes before an extension, and the project's before the
  built-in table's, so `".m": "hash"` reads `.m` otherwise than as
  Objective-C; a `#!` line is read last, and only for a file with no
  extension.
- A path, a pattern, an unknown profile, or an extension named twice in two
  cases is exit 2, naming the key.
- A run, `prove`, `--watch`, the MCP server and `cites` read it; `query` and
  `impact` read no comments.
- A language like none of the profiles needs one of its own, which is code and
  tests here, not configuration
  ([ADR-0006](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0006-comment-classification.md)).

## `allow-empty` - an assertion that covers nothing is a failure

```md
<!-- @assert-absence target="services" symbol="Legacy" glob="*.ts" -->
```

If `services/` holds no `.ts` file, that rule passes every time, forever,
without inspecting anything - and in the report it is indistinguishable from a
rule that inspected a thousand files and found nothing. So it fails instead:

```text
✖ docs/adr.md:3  @assert-absence
    "Legacy" must not appear in services
    no files were inspected, so this assertion verified nothing
    (add allow-empty="true" if that is expected)
```

The usual causes are a `glob` matching no extension in the tree, an `exclude`
that swallowed the target, or a directory somebody emptied. Where covering
nothing yet is the honest state of the world - a rule written before the code
it guards - `allow-empty="true"` says so, and `--allow-empty-scope` says it for
a whole run.

A `target` that does not exist fails the run too: an assertion pointed at a
renamed directory would otherwise search nothing, find nothing and report
success. `--allow-missing-targets` makes it a warning, for a repository where a
path is legitimately optional.

## `baseline` - adopting a rule the codebase already breaks

A strict rule introduced into a mature codebase lands on violations that already
exist. `exclude` turns those into a permanent blind spot, and `expected="5"`
cannot tell "one fixed, one added" from "nothing happened". A baseline names
them:

```md
<!-- @assert-absence target="src" symbol="LegacyGateway"
     baseline="src/legacy/gateway.ts:2
               src/legacy/adapter.ts" -->
```

The rule now holds when no file outside the list matches and no file inside it
matches more than it declares. A bare path means one match.

**It ratchets in both directions.** New debt fails, obviously. So does debt that
has been *paid* and left on the list, because an entry the code no longer
supports is a spec asserting something untrue:

```text
    expected no matches, found 0; the baseline is out of date and must be
    pruned: src/legacy/adapter.ts (no longer matches)
```

The fix is deleting the line the message names. `ratchet="one-way"` relaxes that
half to a report-only note. Every run says how many matches the baseline
excluded, because a pass bought by an exemption is never silent.

To adopt a rule on a codebase that already violates it:

```bash
spec-guard docs/adr.md --print-baseline
```

prints the attribute that would exempt exactly today's violations, for you to
paste in. It prints; it does not edit. [ADR-0009](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0009-debt-baselines.md)
explains why that distinction is the whole design, and why there is no `--fix`
for architecture rules.
