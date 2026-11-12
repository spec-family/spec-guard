# Directives

A directive is a claim about the tree, written under the sentence of a spec
that it makes executable. This page has how one is written and read, and the
text rules; [import rules, layers and cycles](imports.md),
[structure](structure.md), the [attributes](attributes.md) every kind takes and
[regular expressions](regex.md) have pages of their own.

## Writing a directive

Every directive is an HTML comment. It may span multiple lines. Attribute values
may use double or single quotes, and a bare attribute means `="true"`. Inside a
value, `\"`, `\'` and `\\` are escapes and any other backslash is kept, so a
regular expression is written as it reads: `symbol="\bTODO\b" regex="true"`.

There are eight kinds, and each makes one claim about the tree:

| Directive | Claim |
| --- | --- |
| [`@assert-absence`](#assert-absence---this-symbol-is-gone) | this text is gone, or occurs at most N times |
| [`@assert-count`](#assert-count---this-symbol-occurs-exactly--at-least--at-most-n-times) | this text occurs exactly, at least or at most N times |
| [`@assert-import-absence`](imports.md#assert-import-absence--assert-import-count---dependencies-not-text) | no file in scope depends on this module |
| [`@assert-import-count`](imports.md#assert-import-absence--assert-import-count---dependencies-not-text) | exactly, at least or at most N files depend on it |
| [`@assert-layers`](imports.md#assert-layers---dependencies-point-one-way) | dependencies point one way through these layers |
| [`@assert-import-cycle`](imports.md#assert-import-cycle---no-file-depends-on-itself) | no file depends on itself |
| [`@assert-structure`](structure.md) | files are named by a pattern, directories hold their entries, files have their partners |
| [`@assert-present`](#assert-present---this-file-exists) | these paths exist |

A directive is read only where a renderer shows Markdown. In code - fenced and
indented blocks, code spans, `<script>`, `<pre>`, `<style>` and `<textarea>` -
and in front matter it is text, so documentation that shows the syntax, like
this page, never executes it.

- **What is code is what CommonMark says it is**, decided by the Markdown
  scanner every spec-* tool shares. Comments and code spans are resolved left
  to right in one pass, so a backtick inside a comment is a character and
  `<!--` inside a code span is code. A code span ends with its paragraph, so a
  stray backtick cannot hide the directives after it, and a fence may be
  indented with the list item it sits in.
  [ADR-0002](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0002-directive-format.md)'s
  amendment lists where this differs from 0.11.0.
- **What is masked is still counted.** A comment shaped like a directive -
  `<!-- @assert-...` - in code, raw HTML or front matter is not run, and the
  report says how many there were and where, on one line (every one under
  `--verbose`, and in `maskedDirectives` in JSON), so text read as code by
  accident is not a rule gone quiet without a word.
- **A block that never closes is a warning** on its opening line: a code fence
  or raw-text block, which makes the rest of its document code, and front
  matter that opens on the first line and never closes. None of that front
  matter is read as front matter, its status is unrecognised and the document
  stays in force, and the warning, on line 1, says so and says to close it
  with `---`, or `+++` for TOML, on a line of its own. Neither fails a run,
  under `--strict` either.
- **A spec is read as UTF-8, or as UTF-16 when a byte order mark says so**,
  as Windows PowerShell 5.1 writes a file with `>` or `Out-File`. A spec with
  NUL bytes and no mark, which no UTF-8 text holds, is a warning on line 1
  (`unreadable-encoding` in JSON's `specWarnings`): its directives may not
  have been read, so save it as UTF-8, or as UTF-16 with a mark. It fails no
  run, under `--strict` either.
- **Line numbers stay exact.** Masking preserves every offset and line
  terminator.

## `@assert-absence` - this symbol is gone

```md
<!-- @assert-absence target="src/controllers,src/services" symbol="LegacyPaymentGateway" -->
<!-- @assert-absence target="src/" symbol="STRIPE_SECRET_KEY" expected="0" -->
<!-- @assert-absence target="src/" symbol="TODO" expected="5" reason="burn down the backlog" -->
```

Fails when the symbol occurs more than `expected` times (default `0`).
`max="..."` is accepted as a synonym for `expected`. A bound turns the rule into
a budget: "at most 5 TODOs" is an absence claim, and burning a budget down is a
real workflow. A lower bound, `min`, is `@assert-count`'s.

## `@assert-count` - this symbol occurs exactly / at least / at most N times

```md
<!-- @assert-count target="src/" symbol="UserSessionManager" expected="1" -->
<!-- @assert-count target="src/ui/" symbol="PrimaryButton" min="1" -->
<!-- @assert-count target="src/core/" symbol="DeprecatedHelper" max="3" -->
<!-- @assert-count target="src/" symbol="Repository" min="2" max="10" -->
```

Requires `expected`, or `min` and/or `max`. `expected` cannot be combined with
`min`/`max`.

An exact count is the most brittle assertion in the set: a test that merely
mentions the symbol will break it. spec-guard does not silently skip test files
for you - an assertion that quietly ignores part of the tree is the failure mode
this tool exists to prevent - so say what you mean:

```md
<!-- @assert-count target="src" symbol="UserSessionManager" expected="1" exclude="*.test.ts *.spec.ts" -->
```

`min="1"` is often the better rule anyway: it says "this exists" without
breaking every time someone writes a second test.

## `@assert-present` - this file exists

```md
<!-- @assert-present file="SECURITY.md" -->
<!-- @assert-present file="config/production.json,config/staging.json" -->
```

Passes when every listed path exists relative to `--root`. Directories count.
