# spec-guard

**Hold your code to what your Markdown says about it.**

Specs, ADRs, READMEs, agent instructions: the claims they make about your
codebase become assertions that run in CI, in milliseconds, with no runtime
dependencies.

```md
The retired payment gateway is gone from the service layer.

<!-- @assert-absence target="src/services" symbol="LegacyPaymentGateway" -->
```

If someone reintroduces `LegacyPaymentGateway`, CI fails and points at the line
of the ADR that promised it was gone.

The words the spec-* tools share are defined in
[concepts](https://github.com/spec-family/spec-core/blob/main/docs/concepts.md),
and the [tutorial](https://github.com/spec-family/spec-core/blob/main/docs/tutorial.md)
runs spec-guard beside its siblings through one round of work on a small
repository.

---

## Why this exists

Architecture Decision Records, RFCs and technical briefs are full of hard claims
about a repository:

- *"`LegacyPaymentGateway` no longer exists anywhere in the service layer."*
- *"There is exactly one `UserSessionManager`."*
- *"No secret is ever read from `process.env` outside `src/config`."*

Every one of those claims is true on the day it is written and unverified from
the day after. Prose does not fail a build. Six months later the document is
still confidently asserting something the code stopped doing in March.

That has always been an annoyance. It became a defect multiplier the moment
coding agents started reading these documents as ground truth. An agent that
reads *"module X does not exist yet"* will happily build a second X. A reviewer
who trusts *"this symbol occurs zero times"* skips the grep. Stale documentation
is now executable in the worst sense: it executes inside someone's head, or
inside a model's context window, and produces work that has to be thrown away.

spec-guard makes the claims executable in the good sense. It reads directives
written as ordinary HTML comments - invisible in every Markdown renderer - and
checks them against the real tree with ripgrep. A stale claim becomes a failing
build with a line number, not a landmine.

## Quickstart

```bash
npm install --save-dev @spec-family/spec-guard
npx --no-install @spec-family/spec-guard "docs/**/*.md"
```

`npx` is given the package's full name, here and in every command below:
[Names](#names) says why the command's name alone is not written.

Add a directive to any Markdown file, here `docs/adr/0007-sessions.md`,
directly under the sentence it makes executable:

```md
## Decision

Session state has exactly one owner.

<!-- @assert-count target="src/" symbol="UserSessionManager" expected="1" -->
```

Run it:

```bash
npx --no-install @spec-family/spec-guard "docs/**/*.md" --verbose
```

```text
spec-guard 1 spec · 1 assertion · javascript

✔ docs/adr/0007-sessions.md:5  @assert-count "UserSessionManager" (1 match) in src

1 passed · 11ms
✔ every spec assertion holds
```

And when it drifts:

```text
spec-guard 1 spec · 1 assertion · javascript

✖ docs/adr/0007-sessions.md:5  @assert-count
    "UserSessionManager" must appear exactly 1 time in src
    expected exactly 1 match, found 3
      src/auth/UserSessionManager.ts:12:14  export class UserSessionManager {
      src/legacy/sessions.ts:3:10  import { UserSessionManager } from '../auth';
      src/workers/refresh.ts:8:30  const manager = new auth.UserSessionManager(store);

0 passed · 1 failed · 12ms
```

Exit code 1. The ADR is now a test. A Windows console other than Windows
Terminal or VS Code's writes `+`, `x`, `!` and `o` for the marks
([ASCII and the marks](docs/reference/cli.md#ascii-and-the-marks)).

## Names

The package is `@spec-family/spec-guard`, and the command it installs is
`spec-guard`. The name without the scope is not this project: on npm,
`spec-guard` belonged to nobody on 2026-10-07, and whoever registers it decides
what it runs.

`npx` fetches and runs the package of whatever name it is given when the
project has none installed - a fresh clone, a worktree before `npm ci`, a CI job
without the install step - and without a terminal it does not ask first. So
give `npx` the full name:

- `npx --no-install @spec-family/spec-guard` in a project that installed it: it
  runs that install, the version the lockfile pins, and where there is none it
  stops with an error that names this package.
- `npx @spec-family/spec-guard`, without `--no-install`, where nothing is
  installed: it fetches this package and runs it.

<!-- bare-name: the two forms in the next sentence are shown as what not to write -->
Never `npx spec-guard`, and not `npx --no-install spec-guard` either:
`--no-install` stops a download, and npm still runs a copy of the bare name's
package that an earlier fetch left in its cache. The family's
[adopting guide](https://github.com/spec-family/spec-core/blob/main/docs/adopting.md#names)
has what was measured, under npm 10, 11 and 12.

The command alone, `spec-guard`, is what a `package.json` script holds - npm
fetches nothing for a script - and what a global install puts on the path:

```bash
npm install -g @spec-family/spec-guard   # then: spec-guard "docs/**/*.md"
```

## Directives

Every directive is an HTML comment, written directly under the sentence it
makes executable. It is read only where a renderer shows Markdown: in code and
in front matter it is text, so documentation that shows the syntax, like this
README, never executes it. There are eight kinds, and each makes one claim
about the tree:

| Directive | Claim |
| --- | --- |
| [`@assert-absence`](docs/reference/directives.md#assert-absence---this-symbol-is-gone) | this text is gone, or occurs at most N times |
| [`@assert-count`](docs/reference/directives.md#assert-count---this-symbol-occurs-exactly--at-least--at-most-n-times) | this text occurs exactly, at least or at most N times |
| [`@assert-import-absence`](docs/reference/imports.md#assert-import-absence--assert-import-count---dependencies-not-text) | no file in scope depends on this module |
| [`@assert-import-count`](docs/reference/imports.md#assert-import-absence--assert-import-count---dependencies-not-text) | exactly, at least or at most N files depend on it |
| [`@assert-layers`](docs/reference/imports.md#assert-layers---dependencies-point-one-way) | dependencies point one way through these layers |
| [`@assert-import-cycle`](docs/reference/imports.md#assert-import-cycle---no-file-depends-on-itself) | no file depends on itself |
| [`@assert-structure`](docs/reference/structure.md) | files are named by a pattern, directories hold their entries, files have their partners |
| [`@assert-present`](docs/reference/directives.md#assert-present---this-file-exists) | these paths exist |

The import rules read the dependency rather than the text, in JavaScript and
TypeScript, Python, Go, Rust and C#, and say what they could not resolve -
a dynamic import, a path alias, a pattern on a path held to imports by
module name - rather than counting it clean. A match inside a comment does not count unless
a rule asks for it, a rule that inspects no file fails, and a `baseline`
adopts a rule the code already breaks without hiding what is added
([attributes](docs/reference/attributes.md)). A draft, a proposal or a
superseded ADR is read and reported, and its directives are not executed
([document status](docs/reference/document-status.md)).

## Commands

```bash
spec-guard [patterns...] [options]     # execute the directives
spec-guard --watch [patterns...]       # execute them again whenever the tree changes
spec-guard query <paths...> [options]  # the rules in force for files or directories
spec-guard mcp [options]               # serve the rules over MCP on stdio
spec-guard prove [patterns...]         # show each rule a violation of itself, in memory
spec-guard cites [paths...]            # check each spec a code comment cites exists and is in force
spec-guard claims [options]            # hold each claim a specification labels to the evidence its label asks for
spec-guard impact <paths...>           # the files that depend on each path, and the rules in play there
```

- [**`query`** and **`mcp`**](docs/reference/query-and-mcp.md) answer which
  rules govern a path before anyone writes to it, from the specs alone, and
  serve that answer to an agent over the Model Context Protocol. The server
  is listed in the official MCP Registry as `io.github.spec-family/spec-guard`.
- [**`prove`**](docs/reference/prove.md) shows each rule a violation of
  itself, in memory, and fails a rule that still passes.
- [**`cites`**](docs/reference/cites.md) holds each decision a code comment
  cites to a document that exists and is in force.
- [**`claims`**](docs/reference/claims.md) holds each claim a specification
  labels to the evidence its label asks for.
- [**`impact`**](docs/reference/impact.md) lists the files that depend on a
  path, however far away, and the rules in play there.
- [**`--watch`**](docs/reference/watch.md) re-executes only the rules a
  change can affect.

Exit code 0 is every assertion held, 1 is an assertion that failed, and 2 is a
run that could not be trusted: bad usage, a malformed configuration, no spec
matched. [CLI](docs/reference/cli.md) has every option and
[every exit code](docs/reference/cli.md#exit-codes).

## Configuration

The options that are a project's policy can live in `package.json`, under
`"specGuard"`, so CI, a pre-commit hook and the MCP server an agent starts all
hold the same rules the same way:

```json
{
  "specGuard": {
    "specs": ["docs/**/*.md", "README.md"],
    "strict": true
  }
}
```

A root with no `package.json` keeps the same options, at the top level, in
`.spec-guard.json`. The command line wins over either, and every report says
what it took from the file. [Configuration](docs/reference/configuration.md)
has every key.

## CI integration

```yaml
# .github/workflows/specs.yml
name: Specs
on:
  push:
    branches: [main]
  pull_request:

jobs:
  spec-guard:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: '22'
      - run: npm ci
      - run: npx --no-install @spec-family/spec-guard "docs/**/*.md" "README.md" --verbose
```

That job needs nothing else installed: without ripgrep the built-in scanner
runs, and gives the same answer. [CI integration](docs/reference/ci.md) has
why the actions and spec-guard are pinned, installing ripgrep, a pre-commit
hook, and `--format sarif`, `github` and `gitlab`, which place each finding on
its line of a pull request or a merge request.

## Reference

The full reference is in [`docs/reference/`](docs/reference/README.md), a
topic to a page, which the package ships beside this README:

- **The rules.** [Directives](docs/reference/directives.md), how one is
  written and read, and the text rules;
  [import rules, layers and cycles](docs/reference/imports.md);
  [structure](docs/reference/structure.md);
  [attributes](docs/reference/attributes.md), with `exclude`, `comments`,
  `allow-empty` and `baseline`;
  [regular expressions](docs/reference/regex.md), the one dialect both
  engines read; [what gets searched](docs/reference/search-scope.md); and
  [document status](docs/reference/document-status.md), drafts and superseded
  ADRs.
- **The commands.** [CLI](docs/reference/cli.md), with every option and exit
  code; [configuration](docs/reference/configuration.md);
  [watch mode](docs/reference/watch.md);
  [`query` and the MCP server](docs/reference/query-and-mcp.md);
  [`prove`](docs/reference/prove.md); [`cites`](docs/reference/cites.md);
  [`claims`](docs/reference/claims.md); and
  [`impact`](docs/reference/impact.md).
- **Around them.** [CI integration](docs/reference/ci.md), with the formats
  that annotate a pull request; the [programmatic API](docs/reference/api.md);
  [how it works](docs/reference/how-it-works.md), with what a run costs; and
  the [design decisions](docs/reference/design-decisions.md), an index of the
  ADRs.

The guides are the family's, in spec-core: the
[tutorial](https://github.com/spec-family/spec-core/blob/main/docs/tutorial.md)
runs spec-guard beside its siblings through one round of work on a small
repository, [adopting](https://github.com/spec-family/spec-core/blob/main/docs/adopting.md)
brings the tools into a repository that already exists, and
[concepts](https://github.com/spec-family/spec-core/blob/main/docs/concepts.md)
defines the words they share.

## spec-guard checks itself

The invariants in [`docs/adr/0001-invariants.md`](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0001-invariants.md)
and [`docs/adr/0002-directive-format.md`](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0002-directive-format.md) are
executed against this repository on every CI run. The CLI never calls
`console.log`, nothing outside the engine spawns a process, and the parser and
reporter never touch the filesystem - because those documents say so, and the
build fails if they stop being true. CI proves every one of those rules can
fail, and `spec-guard cites` holds every ADR a comment in the code cites to
existing and being in force.

Line coverage is 100%, CI's full mutation sweep kills 99.27% of 16,757 mutants
(0.35.0), and every survivor a release adds is replayed before it ships
([ADR-0003](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0003-mutation-testing.md));
[CONTRIBUTING.md](https://github.com/spec-family/spec-guard/blob/main/CONTRIBUTING.md)
has how to build, test and release, and
[SECURITY.md](https://github.com/spec-family/spec-guard/blob/main/SECURITY.md)
how to report a vulnerability.

This README is executable too:

<!-- @assert-present file="src/parser.ts,src/engine.ts,src/reporter.ts,src/runner.ts,src/cli.ts,src/comments.ts" -->

## Requirements

- Node.js 22 or newer (native ESM)
- ripgrep optional - used when present, replaced by a built-in scanner when not

## License

MIT
