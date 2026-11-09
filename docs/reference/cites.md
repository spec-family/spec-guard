# Do the comments cite decisions in force? - `cites`

Code comments cite decisions - `// ADR-0011: the domain imports no
infrastructure`, `# see ADR-7`, `/* Q-172 */` - and the claim goes stale the
way code does: the document was never written, or it has since been superseded.
`spec-guard cites` reads the comment text of every source file for the ids a
project names, and reports each citation of a document that does not exist or
is no longer in force:

```bash
spec-guard cites
```

```text
spec-guard cites ADR-{n} (10 documents matching docs/adr/{n}-*.md); RFC-{n} (2 documents matching docs/rfcs/rfc-{n}.md)

⚠ crates/ledger/src/journal.rs:1 cites ADR-0007, which is superseded - cite ADR-0009 instead  stale-citation
    hint: docs/adr/0007-async-journal.md says "superseded by ADR-0009"
✖ crates/ledger/src/lib.rs:28 cites ADR-0011, which no document defines  ghost-citation
    hint: no document matching docs/adr/{n}-*.md has the number 11; the nearest is ADR-0010

3 citations in 2 files · 1 ghost · 1 stale · 22ms
✖ 1 citation names a document that does not exist
```

The families of documents are named in the configuration, one entry each - an
id with `{n}` for the number, and a path glob naming the documents with `{n}`
in the file name:

```json
{
  "cites": [
    { "id": "ADR-{n}", "files": "docs/adr/{n}-*.md" },
    { "id": "RFC-{n}", "files": "docs/rfcs/rfc-{n}.md" }
  ]
}
```

- **The number is a number**: `ADR-7`, `ADR-007` and `docs/adr/0007-x.md` are
  one document. An id has a word boundary on each side, so `XADR-1` and
  `ADR-12a` are not citations, and one id on one line is one finding however
  often it is written there.
- **Without `cites`**, a directory of specs whose names begin with a number, and
  whose titles all begin with one id and that number (`# ADR-0007: ...` in
  `0007-x.md`), is read as a family. Anything less is not guessed at: the
  command exits 0 with a note saying to name the documents.
- **A spec pattern that matches no file** beside others that do is named on
  stderr, after the report, and `--json` carries it as `unmatchedSpecs`.
  Read off the specs, a family kept under that pattern is one the check no
  longer has: after `rfcs` was renamed, a comment citing an RFC nobody wrote
  passed. So without `cites` the line says no citation of a document under
  it was looked for, and `--strict` fails the check. Families `cites` names
  are found by their own globs and lose nothing: there the pattern is only
  named. `cites` takes no `--allow-empty`, since it refuses nothing.
- **Comment text only**, as the comment classifier reads it: an id in a string,
  a raw string or a YAML value is not a citation. Markdown is spec-graph's and
  is not read, nor are the spec files, the project's `exclude`, the default
  skips, and another git work tree below the root, which is named, and is
  `workTrees` in `--json`. Files in a language whose comments spec-guard does
  not know are counted by extension, and a file read in part - binary,
  unreadable, or a scan that lost its place - is named.
- **Another project's ids are not checked**: `spec-core's ADR-0005`,
  `spec-graph ADR-0017` or `its ADR-12` name a document in another repository,
  and are counted instead.
- **Stale** is `superseded`, `deprecated`, `rejected` or `archived`; a draft or
  proposal cited from the code implementing it is not. The successor is read
  from the document's status line - `Superseded by ADR-0014` - and followed to
  the one in force.

| Found | Exit |
| --- | --- |
| a ghost citation | 1 |
| a stale citation | 0, as a warning; 1 under `--strict` |
| a file read in part | 0, and named; 1 under `--strict`, and every format then places it as an `unread-comments` finding, an error, with what to do |
| a check that looked for nothing or read no source file | 0; 1 under `--strict`, and every format then places it as a `nothing-read` finding, an error, with what to do |
| a spec pattern that matched no file beside others that did | 0, and named on stderr; 1 under `--strict` where the families are read off the specs: the line says so, and every format places an `unread-family` finding, an error, with what to do |
| a family whose files match no document | 2 |

The report's last line is `every citation names a document in force` only
when the check passed. One that failed ends on what failed it: the line for
a ghost, for a check that read nothing or for a stale citation, and then,
under `--strict`, a line for the files read in part and a line for the
patterns that left a family unread. `--json` says which of the three that
are no citation it was, beside `"ok": false`: `nothingRead`,
`unreadComments` or `unreadFamily`.

`--json` (versioned by `formatVersion`), `--format sarif`, `--format github`
and `--format gitlab` carry the same findings; `spec-guard cites src lib/a.ts`
reads only those paths.
[ADR-0017](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0017-citations-in-comments.md) has the design, and what is
out of scope: links to symbols, which need a parser the family does not ship.
