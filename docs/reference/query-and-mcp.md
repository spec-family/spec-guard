# Asking before writing - `query` and the MCP server

A run tells you, after the fact, that code broke a rule. `spec-guard query`
tells you which rules a file is under before you touch it:

```bash
spec-guard query src/domain/user.ts --spec "docs/**/*.md"
```

```text
src/domain/user.ts
  3 rules from 2 documents

  ADR-0004: No legacy client  (docs/adr/0004-legacy.md, accepted)
    :12 @assert-absence  "LegacyClient" must not appear in src

  ADR-0011: Layering constraints  (docs/adr/0011-layers.md, accepted)
    :40 @assert-layers  src must keep its layers in order, src/domain < src/application < src/infrastructure
      layer: src/domain (1 of 3)
      may import: src/domain
      must not import: src/application, src/infrastructure
      reason: the domain depends on nothing
    :41 @assert-import-absence  src/domain must not import "pg"

  1 more rule would govern this path if docs/adr/0014-clocks.md (proposed) were in force; --ignore-status lists it

14 spec files read in 6.1ms
```

It answers from the specs alone, without reading the codebase, so it works for
a file that does not exist yet. A directory lists every rule that could reach a
file under it. `--json` is the same answer for a script. Rules in documents that
are not in force are counted and named, never silently left out.

A path that no rule governs because something excluded it says so, since
"nobody wrote a rule" and "somebody set this aside" call for different things:

```text
target/debug/build.rs
  no rules in force govern this path: the project's exclude leaves it out (target)

src/legacy/generated/api.ts
  no rules in force govern this path: exclude="..." leaves it out of 1 rule

  left out by exclude="...":
    docs/adr/0004-legacy.md:12 @assert-absence  "LegacyClient" must not appear in src (excluding src/legacy)
```

In JSON, each path carries `excluded.project`, the project patterns that match
it, and `excluded.rules`, the rules whose own `exclude` leaves it out where the
project's does not.

The arithmetic that decides whether a rule governs a path is tested against the
walk a real run makes, file for file, under both engines and on randomly
generated trees. [ADR-0012](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0012-query-and-mcp.md) lists the two
things it cannot see: file content (binary, oversized, unreadable) and
symbolic links.

**A path is spelled as the disk spells it.** On a filesystem that ignores
case, as Windows' and macOS's do, `query SRC/LOANS.JS` asks about
`src/loans.js`, the file it opens, and the answer, `impact` and the MCP
server's tools name it so; a file still to make under `SRC/` is
`src/new.ts`. On a filesystem that tells case apart a path is taken as
written. A rule whose `target` or `file` is found only because the
filesystem ignores case is said beside the rule, since on Linux it names
nothing ([ADR-0012](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0012-query-and-mcp.md#amended-2026-11-12-a-path-in-another-case)).

## The MCP server

`spec-guard mcp` serves the same answer to an AI agent over the
[Model Context Protocol](https://modelcontextprotocol.io) on stdio, with no
dependency on the MCP SDK. Register it with your client as a stdio server; the
usual `mcpServers` entry is:

```json
{
  "mcpServers": {
    "spec-guard": {
      "command": "npx",
      "args": ["--no-install", "@spec-family/spec-guard", "mcp", "--spec", "docs/**/*.md"]
    }
  }
}
```

A client starts a server with no terminal, wherever it stands, so the entry
gives `npx` the package's [full name](../../README.md#names) behind
`--no-install`: in a tree without the install the server fails to start, and
nothing is fetched.

From 0.33.2 the server is listed in the
[official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.spec-family/spec-guard)
as `io.github.spec-family/spec-guard`, for a client that installs servers
from it. That entry names the package on npm at its release and starts it
with `mcp` alone, in the directory the client starts servers in, where its
specs come from the project's configuration or `docs/**/*.md`; the client
fetches that version itself, where the entry above runs the project's
install.

The root defaults to the directory the client starts the server in; pass
`--root` if yours starts servers somewhere else. On Windows, `npx` is a `.cmd`
script that a client spawning without a shell cannot launch; point `command` at
`node` and the first argument at
`node_modules/@spec-family/spec-guard/bin/spec-guard.js` instead. Run flags such
as `--engine`, `--strict`, `--ignore-status` and `--allow-missing-targets` apply
to its checks.

| Tool | What it does |
| --- | --- |
| `get_architectural_rules(path, include_inactive?)` | The query above, as text and as structured content |
| `check_architecture(paths?)` | A run. Given paths, only the rules that govern them, each over its whole scope, with every violation marked as in those paths or not |
| `get_dependents(paths, depth?, include_inactive?)` | [`impact`](impact.md): the files that import each path, however far away, with the import that leads there, the imports that could not be followed, and the rules in play. The structured content is the document `impact --json` writes |

All three are marked read-only, idempotent and closed-world. The server's
instructions tell an agent when to call each: the rules before creating or
changing a file, the dependents before changing a file others import, and the
check after changing files.

The server starts whatever its patterns match, since a spec may be written
while it runs. Where no spec file matches, the first two tools answer with an
error that names the patterns. Where one pattern matches none beside others
that do, each answer is given from the rest and ends by naming the pattern it
holds no rule from, with `unmatchedSpecs` in its structured content and in
`spec://rules`.

| Resource | What it holds |
| --- | --- |
| `spec://rules` | Every rule in force, as JSON |
| `spec://doc/{+path}` | Any spec document, in force or not |

Both protocol eras are served: clients that open with `initialize` (revisions
2024-10-07 to 2025-11-25), and clients on 2026-07-28 that put the protocol
version on every request and probe with `server/discover`. Every spec is read
again on every request, so an ADR edited mid-session is read as edited, and a
request takes longer the more specs there are: a warm `get_architectural_rules`
took about 7 ms over this repository's 19 and about a third of a second over
1,300 copies of them, on the machine ADR-0012 was measured on.
`scripts/bench-query.mjs`, in the repository, measures yours. ADR-0012 has the
shapes, the sources they follow, and what is deliberately not implemented.
