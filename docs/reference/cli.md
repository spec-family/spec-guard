# CLI

The commands, every option, how a pattern is read, what is refused, and the
exit codes. Each command has a page of its own beside this one:
[`query` and `mcp`](query-and-mcp.md), [`prove`](prove.md),
[`cites`](cites.md), [`claims`](claims.md), [`impact`](impact.md) and
[`--watch`](watch.md); the options a project keeps in a file are in
[configuration](configuration.md).

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

## Options

| Option | Description |
| --- | --- |
| `-r, --root <path>` | Codebase root that assertions resolve against, a directory (default: cwd). One that is not there, or is a file, is exit 2 from every command |
| `--spec <pattern>` | A spec glob or path, repeatable. `query` and `mcp` take their specs only from here. An empty one is refused: `.` is every Markdown file under the root. So is one that matches no file beside others that do (below) |
| `-v, --verbose` | Print passing assertions too; for `claims`, where each label in prose is. `-v` says on stderr that it becomes `--version`, as it is in the family's other tools, in the release after the format freeze: write `--verbose` |
| `--watch` | Report, then report again as the tree changes, until Ctrl+C |
| `--fail-fast` | Stop at the first failing assertion |
| `--json` | Machine-readable report on stdout (same as `--format json`). It starts with the family's envelope, `tool`, `toolVersion`, `command` and `schemaVersion`, and `formatVersion` beside them with `schemaVersion`'s value until the format freeze ends; a failed assertion and a directive that could not be read carry `rule`, `severity` and `hint` ([spec-core's ADR-0005](https://github.com/spec-family/spec-core/blob/main/docs/adr/0005-the-family-contract.md)). Beside a `--format` that names another format it is refused (below) |
| `--format <human\|json\|sarif\|github\|gitlab>` | Output format; `pretty` is `human`, as spec-graph names it. `sarif` uploads to GitHub code scanning, `github` annotates a pull request from the job's log, `gitlab` is a GitLab Code Quality report. Given twice with two formats it is refused, as every option that takes one value is (below) |
| `--engine <auto\|rg\|js>` | Search engine (default `auto`: scanner for small trees, ripgrep for big ones). ripgrep is `rg` on `PATH`, or the program `SPEC_GUARD_RG` names; `rg` with no ripgrep that runs is exit 2 ([CI integration](ci.md#ripgrep)) |
| `--strict` / `--no-strict` | Treat analysis that could not be completed as a failure, and a run that executed no assertion: its specs matched and state no rule in force |
| `--allow-missing-targets` / `--no-allow-missing-targets` | Warn instead of failing when a `target` path does not exist |
| `--allow-empty-scope` / `--no-allow-empty-scope` | Warn instead of failing when an assertion inspects no files |
| `--print-baseline` | Print the `baseline="..."` that would exempt today's violations, and exit |
| `--no-default-skips` / `--default-skips` | Search `.git`, `.hg`, `.svn` and `node_modules` too, and the other git work trees below the root |
| `--exclude <globs>` | Paths no assertion looks at, beside each directive's own `exclude`. Repeatable; replaces the configuration's list, and `--exclude=` clears it. Separators with nothing between them, `","`, are refused |
| `--ignore-status` / `--no-ignore-status` | Execute directives in documents not in force too: draft, proposed, rejected, deprecated, superseded or archived |
| `--include-specs` / `--no-include-specs` | Also count matches inside the spec files themselves |
| `--max-snippets <n>` | Failure snippets per assertion (default 5) |
| `--concurrency <n>` | Search passes in flight at once, 1 or more (default 8) |
| `--depth <n>` | `impact` only: follow dependents at most `n` imports away (default: all) |
| `--allow-empty` | Let a run, `prove` or `impact` through when no spec file matched the patterns, or when one pattern matched none beside others that did, each of which is exit 2 without it; such a pattern is still named on stderr (about the run, not an assertion) |
| `--color` / `--no-color` | Force colour on or off. Without either flag, `NO_COLOR` set to anything turns it off; otherwise `FORCE_COLOR` turns it on, and `FORCE_COLOR=0` or `FORCE_COLOR=false` off; otherwise `TERM=dumb` turns it off; otherwise a terminal has colour. `NO_COLOR` or `FORCE_COLOR` set to nothing is as unset |
| `--ascii` / `--no-ascii` | Write a report in ASCII, or with the marks, on any platform. Either wins over the environment. Without either, `SPEC_GUARD_ASCII` set to anything but nothing, `0` or `false` asks for ASCII; otherwise Windows decides as below |
| `-h, --help` | Print the usage and the options, and exit 0 |
| `--version` | Print the version, and exit 0 |

## Patterns

Patterns are expanded by spec-guard itself, so quoted globs behave identically
on Windows, macOS and Linux. A directory expands to the Markdown files in it.
The second form of each on/off option exists to override a configuration;
beside the first, on one command line, it is refused (below).

## ASCII and the marks

On Windows a report is written in ASCII unless `WT_SESSION` or `TERM_PROGRAM`
is set to something: Windows Terminal sets the first, and VS Code's terminal
and mintty the second. `TERM` is not read for it, since Git for Windows and
the Cygwin and MSYS2 runtimes set it for whatever they start, in a console
whose fonts hold none of the first three marks. Anywhere else the marks are
always drawn. In ASCII a report holds no character of its own beyond it:
`+`, `x`, `!` and `o` for `✔`, `✖`, `⚠` and `○`, `...` for the `…` of what is
left out, a cut line among it, and `-` for the `·` between the counts of a
line. A path, a line of source or a reason is written as the project wrote
it.

Either can be asked for outright. `--ascii` writes a report in ASCII and
`--no-ascii` with the marks, on any platform and whatever the environment
says: an ssh session into Windows names no terminal, and `--no-ascii` is how
it gets the marks its own terminal draws. `SPEC_GUARD_ASCII=1` asks for ASCII
for every run that inherits it; set to nothing, `0` or `false`, in any case,
it asks for nothing, and it never asks for the marks. An option wins over
the variable.

## What is refused

An option that means nothing to a command is refused rather than ignored, so
`spec-guard query --strict` does not look like a strict query. `query` does take
`--no-color`: its output never has colour, and scripts pass the flag to every
command they run. It takes `--ascii` for the same reason, as `impact` does,
and each refuses `--no-ascii` as it refuses `--color`: neither draws a mark.
`mcp` takes none of the four.

So is an option that is set and names nothing, which is exit 2 and a line
that names it, never a run as if it had not been given. `--root "$DIR"` and
`--spec "$DOCS"` with the variable unset were the working directory and every
Markdown file under the root; `--concurrency 0` was 1; and an option that is
on when it is given was on whatever followed its `=`, so `--strict=false` was
strict and `--allow-empty=false` let an empty run through. An option a
configuration can set has an opposite to turn it off, `--no-strict`; any
other is left out.

So is an option given beside its own opposite, in either order: `--strict`
beside `--no-strict`, `--color` beside `--no-color`, and every other pair of
the table. The last of the two used to win, and nothing said the other had
been given; a line that asks for both was not meant, and one of the two would
go unread:

```text
spec-guard: Option --strict is given beside --no-strict, and one of the two would go unread. Give one of the two.
```

The same option given twice is read as once. An opposite alone still wins
over a configuration, which is what it is for. And where a command takes
only one of a pair, as `query` takes `--no-color` and not `--color`, the
other is refused for that, as it was.

So is an option that takes one value and is given two: `--root`, `--format`,
`--engine`, `--max-snippets`, `--concurrency` and `--depth`. The later of the
two used to be read, and nothing said the earlier had been given. And so is
`--json` beside a `--format` that names another format, since `--json` is
`--format json`: `--json --format sarif` wrote SARIF, and
`--format sarif --json` wrote JSON. Each is named as it was written, in the
order the two were given:

```text
spec-guard: Option --json is given beside --format "sarif", and one of the two would go unread. Give one of the two.
```

The same value given twice is read as once, however it is spelled: `--root .`
beside `--root ./`, `--format JSON` beside `--format json`, and `--json`
beside `--format json`. On Windows a drive letter names its volume in either
case, so `--root C:\x` beside `--root c:\x` is one root; the rest of a path
is compared as it resolves, and `--root C:\x` beside `--root C:\X` is two,
since whether they are one directory is the disk's to say. `--spec` and
`--exclude` are lists, and each use adds to its list; `--exclude=` adds
nothing to it, and the configuration's list is replaced either way. Such a
line is refused with `--help` or `--version` on it too, as a line with a
pair is. And `--help` beside `--version` is refused the same way, in either
order: they ask for two answers, and a line gets one.

And so is a spec pattern that matches no file beside others that do. After
`old-docs` was renamed, `spec-guard docs old-docs` ran the specs under `docs`
and said nothing of the rest: every rule in the renamed directory had stopped
running, and the check was green. A run, `prove`, `impact` and `query` now
exit 2 with one line that names each such pattern, wherever it was written, on
the command line or in `specs`:

```text
spec-guard: the pattern "old-docs" matched no spec file. Remove it from "specs" in package.json, or give --allow-empty where a pattern is meant to match nothing.
```

- **`--allow-empty`** lets a run, `prove` or `impact` through, for a place
  nothing is written in yet, and the pattern is still named on stderr.
  `query` takes no such option.
- **A document a script reads is still written**, by `--json`,
  `--format sarif` and `--format gitlab`, and the JSON ones carry the
  patterns as `unmatchedSpecs`. The key is there only when a pattern matched
  no file, and `formatVersion` stays 1: a field added does not move it.
- **`--watch` and `mcp` carry on**, since the file may yet appear. A session
  says which pattern it is waiting on under each report, and each answer the
  server gives names the pattern it holds no rule from, with `unmatchedSpecs`
  in its structured content.
- **`cites` names it and goes on**, as it goes on with no spec at all: the
  report is written, the line follows it on stderr, and `--json` carries
  `unmatchedSpecs`. The exit code is the report's, which is 1 under
  `--strict` where the families were read off the specs
  ([`cites`](cites.md)).
- **No spec at all is as it was**: `no spec files matched ...`, exit 2, or 0
  under `--allow-empty`. So is `docs/**/*.md`, the pattern read when none is
  given, which is alone and so matches or leaves no spec at all.

## Exit codes

"Your specs failed" and "spec-guard could not run" are different facts, and CI
should be able to tell them apart, so they are 1 and 2:

| Code | Meaning |
| --- | --- |
| `0` | Every assertion held |
| `1` | An assertion failed, or a directive was malformed; under `--strict`, the specs matched state no rule in force, so no assertion was executed |
| `1`, `prove` | A rule survived, or under `--strict` none was proved |
| `1`, `cites` | A comment cites a document that does not exist, or under `--strict` a citation is stale, a file was read in part, no source file was read, or a spec pattern matched no file beside others that did and the families are read off the specs |
| `2` | spec-guard could not run, or its answer did not arrive: bad usage, an option set to something that names nothing, a root that is not a directory, a malformed configuration, no spec files matched, a spec pattern that matched none beside others that did, `--engine rg` with no ripgrep, a watch that could not start, a `cites` family whose files match no document, a stdout its reader closed before all of the output was written, as a pipeline into `head` does, said in one line on stderr, or an error spec-guard did not expect, reported on stderr as `spec-guard: unexpected error:` with its stack |
| `130` | A `--watch` session was stopped |
