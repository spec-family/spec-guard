# Design decisions

The README and this reference say what spec-guard does. Why it does it that
way, what was measured and what was left out are in its ADRs, one decision
each:

- [ADR-0001](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0001-invariants.md) -
  spec-guard's own invariants are directives, executed against it on every CI
  run: output through an injected `CliIO`, processes spawned by the engine
  alone, a parser and a reporter that never touch the filesystem.
- [ADR-0002](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0002-directive-format.md) -
  directives are HTML comments, invisible when rendered; code is masked before
  they are read, by spec-core's Markdown scanner, and spec files are left out
  of their own searches.
- [ADR-0003](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0003-mutation-testing.md) -
  mutation testing in CI gates the build, every survivor is replayed rather
  than excused, and vitest is pinned to 4.x until Stryker's runner reads 5.
- [ADR-0004](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0004-adaptive-engine.md) -
  `--engine auto` chooses per search group, by walking the target with a
  budget: the scanner under it, ripgrep over it.
- [ADR-0005](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0005-import-assertions.md) -
  import assertions read the dependency rather than the text, and report what
  they could not resolve rather than counting it clean.
- [ADR-0006](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0006-comment-classification.md) -
  matches inside comments do not count by default, every run says how many it
  dropped, and where spec-guard is unsure, text is code.
- [ADR-0007](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0007-search-scope.md) -
  one scope policy drives both engines: four directory names are skipped,
  `.gitignore` is not read, ripgrep only pre-filters, and every other skip is
  reported.
- [ADR-0008](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0008-polyglot-imports.md) -
  Python, Go, Rust and C# imports are read by masking comments and strings and
  reading statements off the rest, with no parser.
- [ADR-0009](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0009-debt-baselines.md) -
  a baseline names known violations and ratchets both ways; `--print-baseline`
  prints one, and there is no `--fix`.
- [ADR-0010](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0010-spec-status.md) -
  a document's lifecycle status decides whether its directives run, withholding
  is always reported, and there is no per-directive `if-status`.
- [ADR-0011](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0011-layers-and-cycles.md) -
  layers and cycles are read off one import graph; a cycle is counted as a
  knot, and `tsconfig` paths are not resolved.
- [ADR-0012](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0012-query-and-mcp.md) -
  `query` and the MCP server answer which rules govern a path from the specs
  alone, held to the walk a real run makes, with no MCP SDK.
- [ADR-0013](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0013-structure-assertions.md) -
  one structure directive, one claim each - names, required entries or
  partners - with names compared exactly on every platform.
- [ADR-0014](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0014-configuration-and-watch.md) -
  a project's policy lives in `package.json` or `.spec-guard.json`, and a watch
  session re-executes only what a change can affect.
- [ADR-0015](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0015-globs-from-spec-core.md) -
  globs are spec-core's automata, copied in and held by hash, so no pattern
  backtracks.
- [ADR-0016](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0016-rules-seen-to-fail.md) -
  a rule is trusted when it has been seen to fail: `prove` shows each one a
  violation of itself, in memory.
- [ADR-0017](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0017-citations-in-comments.md) -
  a comment that cites a decision is a claim, and `cites` holds it to a
  document that exists and is in force.
- [ADR-0018](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0018-impact.md) -
  `impact` reads the import graph backwards, with the rules in play, and lists
  what it could not follow.
- [ADR-0019](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0019-releases-are-staged-by-ci.md) -
  a release is a `v*` tag on main after its full mutation sweep, staged on npm
  by CI with provenance and published only when the maintainer approves it with
  a second factor.
