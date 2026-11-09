# The spec-guard reference

Everything spec-guard reads, checks, takes and writes, a topic to a page. The
[README](../../README.md) is the front page. The family's guides are
spec-core's: the
[tutorial](https://github.com/spec-family/spec-core/blob/main/docs/tutorial.md)
runs spec-guard beside its siblings through one round of work,
[adopting](https://github.com/spec-family/spec-core/blob/main/docs/adopting.md)
brings the tools into a repository that already exists, and
[concepts](https://github.com/spec-family/spec-core/blob/main/docs/concepts.md)
defines the words they share.

This reference ships in the package, in
`node_modules/@spec-family/spec-guard/docs/reference/`, so the copy a project
installed describes the release it runs. Where these pages write the command
alone, as in `spec-guard prove`, it is what a `package.json` script holds -
npm fetches nothing for a script - and what a global install puts on the
path; at a prompt, a runner is given the package's full name, as the README's
[Names](../../README.md#names) says.

## The rules

- [Directives](directives.md): how a directive is written and read, what is
  code, the directives masked and the blocks that never close; the eight
  kinds; `@assert-absence`, `@assert-count` and `@assert-present`.
- [Import rules, layers and cycles](imports.md): `@assert-import-absence` and
  `@assert-import-count` in five languages, `@assert-layers`, C# and .NET
  solutions, and `@assert-import-cycle`, with what each cannot see.
- [Structure](structure.md): `@assert-structure`, files named by a pattern,
  directories that hold their entries, files that have their partners, and
  names compared exactly on every platform.
- [Attributes](attributes.md): every attribute, and the ones that need more
  than a row: `exclude` and its patterns, `comments`, `allow-empty`, and
  `baseline` with its ratchet.
- [Regular expressions](regex.md): `regex="true"`, the lines a pattern reads,
  the one dialect both engines read, a byte that is no UTF-8, and the Unicode
  each engine has.
- [What gets searched](search-scope.md): the four directories skipped, the
  other git work trees, the spec files left out of their own searches, and
  what is never skipped without a word.
- [Document status](document-status.md): drafts and superseded ADRs, the
  status words and where they are read, what withholding reports, and a run
  in which nothing is in force.

## The commands

- [CLI](cli.md): the commands, every option, how a pattern is read, ASCII and
  the marks, what is refused, and the exit codes.
- [Configuration](configuration.md): `package.json` or `.spec-guard.json`,
  every key, and what a report says it took from the file.
- [Watch mode](watch.md): `--watch`, what a session re-executes, what it
  measured, and what it cannot see.
- [`query` and the MCP server](query-and-mcp.md): the rules that govern a path
  before anyone writes to it, and the server's tools and resources.
- [`prove`](prove.md): each rule shown a violation of itself, in memory, and
  what killed, survived and unprovable mean.
- [`cites`](cites.md): each decision a code comment cites, held to a document
  that exists and is in force; families, ghost and stale citations.
- [`claims`](claims.md): each claim a specification labels, held to the
  evidence its label asks for.
- [`impact`](impact.md): the files that depend on a path, the rules in play
  there, and the imports that could not be followed.

## Around them

- [CI integration](ci.md): a job and its pins, ripgrep, a pre-commit hook,
  SARIF, `--format github` and `gitlab`, the findings each places, and why
  there is no language server.
- [Programmatic API](api.md): the package as a library, an `Io` of your own,
  `proveSpecGuard`, the other commands' functions, and a memo of parsed
  documents.
- [How it works](how-it-works.md): the four stages of a run, what it costs on
  each engine, and why the two engines give one answer.
- [Design decisions](design-decisions.md): the ADRs, one decision each, with
  a line on what each decided.
