# Regular expressions

With `regex="true"`, the `symbol` of an `@assert-absence` or an
`@assert-count` is a regular expression ([attributes](attributes.md)). Both
engines read it the same way, and this page says how.

## Lines

A `regex` is read against each file's whole text, so a match may cross a
line end. `^` and `$` match at the start and the end of every line, a line
ending at LF, at CRLF or at a lone CR, as ripgrep reads one with `--crlf`;
U+2028 and U+2029 end none, and no line follows a file's last line end,
so an empty match there is not counted.
`symbol="^\s*-?\s*uses:"` meets `uses:` on any line, with either engine
([ADR-0007](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0007-search-scope.md)).
`\s` matches a line end too, so `\s+$` also meets a line followed by an
empty one; `[ \t]+$` reads only the blanks a line ends with.

## One dialect

Both engines read a `regex` in one dialect: JavaScript's syntax, with the
meaning ripgrep's regex crate documents wherever the two dialects give the
same text two, since a file ripgrep's reading leaves out is one the scanner
never counts in. A character is a code point, and `ignore-case` folds by
Unicode's simple case folding. `\w` is a letter, a mark, a decimal digit, a
connector such as `_`, or Join_Control, in any script, and `\b`, `\B` and
`word="true"` are read with it; `\d` is a decimal digit of any script; `\s`
is Unicode's white space, so U+FEFF is none and NEL is one. What only
JavaScript reads, a look-around or a back-reference, is read by the scanner
alone, as ripgrep refuses it. What the crate reads and JavaScript would
read otherwise is an invalid directive that names it: `\A`, `\z`, `\<`,
`\>`, `\b{...}`, `\a`, `\x{...}`, `\U`, `\pL`, a class inside a class such
as `[[:alpha:]]`, `&&`, `--` or `~~` in a class, and a count with blanks
in it, `{2, 3}`; so is a group with flags, `(?i:...)`, which Node 22 does
not read. An escaped sign such as `\-` or `\#`, a lone `]` or `}`,
and `[\w-.]` read as they did
([ADR-0007](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0007-search-scope.md),
amended 2026-10-24).

## Time

A `regex` can backtrack without end on some text, as `(a+)+$` does over
thirty `a`s and a `!`, and nothing in a thread can interrupt a match once it
has started. So the scanner gives a regex rule's match on each file a time
budget: a second, and a second more for each whole MiB of the file, far more
than a match takes that runs in time proportional to its text. A file a rule
was stopped on is named, and is a gap, as a file that could not be read is:
`--strict` fails on it, and `--json` has it in `skipped` with
`reason: "timed-out"`.

```text
⚠ 1 file not searched to the end: the regular expression was still matching when its time ran out, as one that backtracks without end does: src/trap.txt
```

ripgrep's regex crate cannot backtrack, so a file ripgrep finds no match in
is not timed at all. A literal `symbol` is never timed: it is escaped before
it is built. V8's linear engine, which cannot backtrack either, refuses the
look-around and the `v` flag the scanner builds a rule with
([ADR-0007](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0007-search-scope.md#amended-2026-11-12-a-regex-rule-runs-within-a-time-budget)).

## A byte that is no UTF-8

A byte that is no UTF-8, in a Latin-1 file say, is no character to a rule,
as ripgrep reads a file's bytes: neither `.` nor any class matches it, `\b`
reads it as no word character, and `\B` and `word="true"` meet no boundary
beside it ([what gets searched](search-scope.md)).

## The Unicode each engine reads

The classes read Unicode as each engine has it. On Node 24 and later the
scanner reads Unicode 17.0, and takes 4,803 code points that version added
for assigned, which ripgrep 15, reading 16.0, does not: the scripts Sidetic,
Tolong Siki, Beria Erfe and Tai Yo, CJK Extension J, and some symbols and
Latin letters. For text in those, `\w`, `\p{L}`, a negated class or
`ignore-case` can answer differently under each engine; `--engine rg` gives
one answer wherever ripgrep is installed
([ADR-0007](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0007-search-scope.md),
amended 2026-11-08).
