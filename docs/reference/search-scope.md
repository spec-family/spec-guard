# What gets searched

An assertion is worth exactly as much as the set of files behind it, so
spec-guard is explicit about that set and never quietly narrows it.

**Four directory names are skipped**, as is another git work tree below the
root (see below), and nothing else:

| Skipped | Why |
| --- | --- |
| `.git`, `.hg`, `.svn` | version-control stores hold compressed copies of code you deleted on purpose |
| `node_modules` | code you did not write, which your architecture rules are not about |

Everything else is searched. That includes **hidden directories** - `.github`,
`.husky`, `.claude-rules`, `.agents` - because that is where CI, hooks and agent
rules live, and a rule that cannot see your workflow files is not enforcing much.
It also includes `dist`, `build`, `out` and `coverage`, because spec-guard
cannot tell build output from a directory of build scripts, and guessing wrong
means a rule silently stops covering anything.

`.gitignore` is not consulted. It describes what git should carry, not what a
rule covers - and ripgrep applies it only inside a git repository, so honouring
it made the same tree answer differently depending on whether a `.git` directory
happened to exist above it.

**A file that is not valid UTF-8 is matched as ripgrep matches it**, with
either engine: a byte outside UTF-8, in a Latin-1 file say, is no character,
so neither `.` nor any class matches it. Only a pattern that could match a
character there, or meet a boundary beside one, can answer otherwise than
the text a person reads: a character outside ASCII, `.`, a class or its
negation, `\w`, `\b`, `\B` and `word="true"`. A rule's notes name each file
it matched in that holds such a byte, under `--verbose` for a passing rule;
a file it found nothing in is not named, as ripgrep names the scanner only
the files that match
([ADR-0007](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0007-search-scope.md),
amended 2026-11-08).

To narrow scope, say so in the assertion:

```md
<!-- @assert-absence target="src" symbol="TODO" exclude="dist coverage" -->
```

**Another git work tree below the root is not read either**: a directory
holding a `.git` file, as a linked worktree and a submodule do (a
desktop-app session keeps its worktree under `.claude/worktrees`), or a
`.git` directory with a `HEAD`, as a clone does. Its files are another
checkout's: read, a stale citation in a session's worktree failed
`cites --strict` in the checkout above it. A run names each one it left
out, and `--json` has it in `skipped` with `reason: "worktree"`, which
`--strict` does not fail on:

```text
⚠ 1 other git work tree not read: .claude/worktrees/feature
```

Where a walk starts is read as asked, so a root that is itself a worktree is
read, and a rule can name a work tree as its `target`. `query` and the MCP
server read no file, so they cannot tell a work tree from a directory
([ADR-0007](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0007-search-scope.md)).

`--no-default-skips` removes even those four, and reads the other work trees
too, for a run that has to be certain.

## Spec files are left out of their own searches

An ADR that says "`LegacyGateway` must not appear" contains the string
`LegacyGateway`, so without this every absence rule would fail on the document
asserting it - the single most confusing possible first-run experience.
- **`--include-specs`** restores the naive behaviour, and counts the prose of
  your specs.
- **The directives themselves stay uncounted** even then: a directive is an
  HTML comment, and a rule whose own text trips it can never be satisfied.
  `comments="include"` counts even those.
- **`@assert-structure`**, which reads names rather than text, is the one rule
  that counts the spec files.

## Nothing is skipped quietly

A file spec-guard could not read, or one whose bytes are not text but which
contained the symbol anyway, is a gap in the answer rather than a detail of it.
Those are reported, and `--strict` fails on them:

```text
✖ docs/adr.md:3  @assert-absence
    "ApiKey" must not appear in .
    expected no matches, found 0, and 1 file could not be inspected
    ⚠ 1 match in 1 binary file not counted: build/app.bin
```

The counts are in `--json` too, as `skipped` on each result.

**A file larger than 20 MiB is not read, and is named.** The built-in scanner
reads a file whole, so a file over 20 MiB (20,971,520 bytes; a file of
exactly that size is read) is left out of every rule and said:

```text
⚠ 1 file larger than 20 MiB not read: data/dump.sql
```

`--json` has it in `skipped` with `reason: "too-large"`. ripgrep searches a
file of any size, so under it only a large file that holds the symbol is
named, since one it found nothing in was read. `--strict` does not fail on it
yet; the release after the family's format freeze does
([ADR-0007](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0007-search-scope.md#amended-2026-11-12-a-file-over-the-size-limit-is-named)).
To leave such a file out on purpose, `exclude` it.
