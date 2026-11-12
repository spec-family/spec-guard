# Security policy

## Supported versions

| Version of `@spec-family/spec-guard` | Gets security fixes |
| --- | --- |
| The latest minor release on npm | Yes, in a patch release of that minor |
| Any earlier minor | No: upgrade to the latest |

Before 1.0 a fix is made once, on the latest minor, as the family's versions
policy ([spec-core ADR-0009](https://github.com/spec-family/spec-core/blob/main/docs/adr/0009-versions-before-1-0.md))
sets out.

## What a spec can make spec-guard do

A spec, the configuration and a request to the MCP server are input, and so
is every file a rule reads. Two of them cost time the input chooses:

- **A glob or a path pattern** is read by spec-core's automata, which cannot
  backtrack, and is never compiled to a `RegExp`
  ([ADR-0015](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0015-globs-from-spec-core.md)).
- **A regular expression a rule names with `regex="true"`** is compiled to a
  `RegExp`, which can backtrack without end on text chosen for it. Its match
  on each file runs within a time budget, a second and a second more for each
  MiB of the file, and a file it was stopped on is reported as a gap, which
  `--strict` fails on
  ([ADR-0007](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0007-search-scope.md#amended-2026-11-12-a-regex-rule-runs-within-a-time-budget)).
  A run, and an MCP server answering a request, is held up by at most that
  budget for each file such a rule reads, never without end.

A way to make spec-guard take time without end, or read outside the root it
was given, is a vulnerability: report it as below.

## Reporting a vulnerability

Report it privately, through GitHub's private vulnerability reporting: the
repository's **Security** tab, then **Report a vulnerability**. Only the
maintainer sees the report.

Do not open a public issue, pull request or discussion about a vulnerability,
and do not show it in one, until a fixed release is out.

A useful report names the version, what an attacker has to control - a spec, a
file in the tree, the configuration, a request to the MCP server - and what
happens then, with the smallest reproduction you have.

## What to expect

- An acknowledgement of the report.
- A fix in a patch release, with an advisory that says which versions are
  affected and what to upgrade to.
- Credit in the advisory and the changelog, if you want it.
