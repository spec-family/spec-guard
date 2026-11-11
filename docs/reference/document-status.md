# Document status - drafts and superseded ADRs

An ADR has a life. It is `Proposed` before anyone agrees to it, and `Superseded`
long before anyone deletes it - because deleting it deletes the reason a
decision was made.

spec-guard reads that status from the document and honours it. A document whose
status is `draft`, `proposed`, `rejected`, `deprecated`, `superseded` or
`archived` is parsed, validated, reported - and not executed. `archived` is what
`spec-brief` writes when it closes a task brief's round: the brief is kept as
the record, and its directives, which stated the round's premises and goals,
are history.

Four spellings are recognised, because four are in use:

<!-- Shown fenced on purpose: spec-guard masks code before reading a status. -->

```md
---
status: proposed
---
```

```md
## Status

Accepted (0.3.0).
```

```md
| Status | Accepted |
| ------ | -------- |
```

```md
**Status:** accepted
```

Front-matter wins, then the `## Status` section, then a table, then the bold
label, and the first of them that is there decides:

- **Front matter** is YAML between `---` lines or TOML between `+++` lines. Of
  TOML, only the top-level `status` key is read, and only as a string on one
  line: `status = "accepted"` or `status = 'accepted'`. Front matter without a
  `status` key, YAML or TOML, hands over to the section, the table and the
  label.
- **A section's value** is its first line of prose before the next heading.
  Headings are read as CommonMark reads them, so an underlined `Status` is the
  section and a `## Status` kept in a comment is not.
- **Comments are not read**, in the section, the table or the label, as a
  reader of the rendered document sees none: `<!-- one of: draft, accepted -->`
  above or beside the value is no part of it, and a section or a cell that
  holds only a comment is empty.
- **The table and the label** are only read above the first section heading.
  A table is read when it has exactly two columns and one of its rows, the
  header row or another, names the status in its left cell - `Status` or
  `State`, in any case, bold or not - and gives it in the right. A table of
  more columns, or one further down, is a register or a legend of other
  documents and is never read for this one's status.
- **A status that cannot be read still decides**: the document stays in force,
  the report warns on its line with the reason, and nothing ranked below it is
  read in its place. In front matter that is a value such as
  `status: "accepted" (2024-05-01)`, text after a closing quote, or in TOML a
  multi-line string, an array, a table or a value that is not a string; in a
  section, a table or a label, an empty section or a line that begins with no
  word.
- **Front matter that opens on the first line and never closes** is read the
  same way: none of it can be read, so the status is unrecognised, the document
  stays in force, the section and the label are not read in its place, and the
  report warns on line 1 and says how to close it.
- **Anything else** - `Provisional`, `In review`, a misspelled `Supersedded`, or
  no status at all - keeps enforcing.

That asymmetry is deliberate: an unanticipated word that keeps enforcing is a
visible failure with an obvious fix, while one that stops enforcing is a green
build over a rule nobody is checking.

The status is read in English. A document may be written in any language, and
its status is written in English under an English key - `status: superseded`,
or `## Status` over `Superseded by ADR-0007` - which every spec-* tool reads.
A word in another language under that key, `status: 已取代`, is a status that
cannot be read: the document stays in force, and the report warns and says to
write the status as an English word. A key in another language, `## 狀態` or
`| 狀態 | 已取代 |`, names no status, and the document stays in force.

Withholding is never quiet:

```text
○ docs/adr/0011-queues.md is Proposed. - 2 assertions not executed

12 passed · 2 not in force · 48ms
```

By name, not by count - the same fact reaches `--format json` as `inactiveSpecs`
and `--format sarif` as a note-level execution notification. A withheld
directive is still checked for typos and bad attributes, so a draft's mistake is
found on the day it is written rather than on the day it is accepted.
`--ignore-status` runs everything, which is how you ask whether a draft would
pass if you accepted it today.

## Documents whose status means nothing

Some documents write a status that says nothing about whether they are in
force. Spec Kit writes every specification `**Status**: Draft` and never
changes it, so its rules never ran, and a claim's test under it was no
evidence. `"ignoreStatus"` in the [configuration](configuration.md) takes a
list of spec patterns for them, written as `specs` is - a file, a directory
for the Markdown files under it, or a glob - but for two that are refused,
exit 2: the root, `"."` or `"./"`, which names every document, and a
pattern that starts with `!`, since a list takes nothing back. spec-graph
refuses both in its own `ignoreStatus`, so a list either tool takes means
the same in both:

```json
{
  "specs": ["specs/**/*.md", "docs/**/*.md"],
  "ignoreStatus": ["specs/**/*.md"]
}
```

The status of a document the list matches is not read. It is in force, and
the status it writes is neither reported nor warned about: its rules run,
`query`, `impact` and the MCP server list them as rules in force with no
status, `prove` proves them, and `claims` counts the directives under its
claims. Every other document's status is read as above, so a draft decision
under `docs/` stays a draft. `"ignoreStatus": true` is `--ignore-status`
for every run, and `--no-ignore-status` reads every status, whichever form
the configuration holds. spec-graph reads the same key with the same meaning.

A run in which nothing is in force executes no assertion, and says so rather
than that every assertion holds: `no assertion was executed, so nothing was
verified`. Under `--strict`, or `"strict": true`, that run fails, exit 1, as
the family contract has a check that measured nothing do: JSON says
`"ok": false` and `"nothingVerified": true`, and SARIF, GitHub and GitLab carry
a `nothing-verified` finding. One rule in force is enough to pass, whatever else
is withheld; and the MCP server's check of paths that no rule governs verified
what it was asked to, and passes.

[ADR-0010](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0010-spec-status.md) has the full reasoning, including why
there is no per-directive `if-status` attribute.
