# ADR-0020: A claim is held to its evidence

## Status

Accepted (2026-11-07).

## Context

A consumer of the family marks each item of its specifications with how far
it holds:

```md
- `Implemented`, as a token check only: `refund` raises
  `E0420 [Refund Error]` when the amount is over what was captured.
```

Its rule is that `Implemented` needs a unit test that fails when the
behaviour breaks, named by a directive. Nothing held the label to it: the
directives sat in a section at the end of the file, linked to no item, and
the one behind this claim counted an error string, not a test. A label
raised from `Specified` to `Implemented` by hand, with nothing behind it,
passed every check. Each such gap lets a document claim more than its
evidence shows while every tool passes, and making "a claim without its
evidence" a failing check is what the consumer asked for, as a feature any
repository can configure.

Which item is a claim, and of which label, is read by spec-core's
`findClaims` (its ADR-0004, amended 2026-11-07), since spec-graph will hold a
checklist or a ledger to the claims it cites and must read the same ones.
Measured on 0.31.0 before anything was written: a directive written under a
list item, nested, two spaces deep or four after a blank line, is read as any
other.

## Decision

**`spec-guard claims` reads the documents the configuration names, holds each
claim to what its label asks, and fails, exit 1, where one does not.**

<!-- @assert-present file="src/claims.ts, tests/claims.test.ts" reason="the check and its tests" -->

```json
{
  "claims": {
    "files": ["spec/*.md"],
    "labels": {
      "Implemented": { "evidence": "test" },
      "Specified": {},
      "Target": {},
      "Hypothesis": { "criterion": "Criterion:" }
    },
    "testPrefixes": ["fn test_"]
  }
}
```

- **A claim is a list item that opens with a label as a code span**, after a
  checkbox where there is one, exact in case. The vocabulary is the
  configuration's, in the order the report totals it. Prose, emphasis or a
  span the vocabulary lacks makes no claim.
- **The evidence is a directive written under the claim**: inside the item,
  and the innermost claim around it, so a nested item's directive is its
  own. No syntax of its own, and no number: the evidence stays next to what
  it is evidence for, survives the items being reordered, and renders as
  nothing on GitHub. A claim that other documents cite is named the way
  spec-graph names an item, `<!-- @spec-item id="float-square-ensures" -->`.
  What is under an item is what spec-core's list reading gives it: a
  directive on the line right after the item's text, with no blank line
  between, is read as the item's continuation at any indent, and one past a
  blank line at the item's own indent or less is not.
- **`evidence: "test"`** asks for at least one such directive that counts a
  test: an `@assert-count` whose `symbol` starts with one of `testPrefixes`
  and whose `min` or `expected` is at least 1, in a document in force, which
  `prove` shows can fail ([ADR-0016](0016-rules-seen-to-fail.md)). A count of
  an error string is no evidence of a test; neither is an absence, a `max`
  alone, a directive in a draft, a rule that fails on the tree as it stands,
  or one that passes whatever is planted. Each such finding says which it
  was.
- **`criterion`** asks for text in the claim's own words, the item less what
  is nested under it, such as `Criterion:`, where a hypothesis says what
  would settle it. Directives under a claim whose label asks for no test are
  run as rules and are evidence of nothing.
- **One label per claim.** An item whose own words hold two labels as code
  spans, `` `Specified`; the partial refund is `Implemented` ``, is a finding:
  the consumer writes that today, and moves to one item per label.
- **The totals of each label** are in the report and in JSON, and never
  written into a document.
- **A command of its own**, as `cites` is, with JSON (`formatVersion` 1),
  SARIF, and GitHub and GitLab annotations. It reads `exclude`,
  `defaultSkips` and `comments`, which decide whether a count under a claim
  finds its test; a missing target or an empty scope fails a count of at
  least one either way, so neither is read. No `claims`
  in the configuration, or `files` that match no file, is exit 2; a pattern
  among them that matched nothing is named.
- **A proof only where it is asked for**: `prove` runs, once for every
  document, where some claim's label asks for a test and a directive under it
  names one.

## Not this round

- **A label raised between two refs.** spec-graph's ADR-0020 has a diff
  describe and a check gate: the gate is this check at the head, which fails
  a raised label with no evidence as it fails any, and listing what was
  raised is a diff's, later.
- **`Target` and a measurement protocol**, which wait for the measurement
  records of a later round; `Target` asks for nothing until then.
- **An `assumes` edge** from a claim to the claims it rests on.

## Consequences

A repository that names no `claims` sees nothing change. One that does has a
check that fails where a specification says more than its evidence shows,
with the claim's line, and the consumer's specifications are expected to fail
it in many places until they move to one label per item and name a test under
each `Implemented`: those are true findings.

## Amended 2026-11-08: a label in prose is said

A claim is a list item that opens with a label as a code span, so a label
written anywhere else was read as nothing, and nothing said so:
`(Implemented)` in a sentence, `## Specified` over a list, a `Target` cell
in a status table, a span that opens no item. A document could mark part of
itself implemented in words the check never held. The maintainer decided on
2026-11-08 that the report says so in a note, and that the exit code does
not change for it.

<!-- @assert-count target="src/claims.ts" symbol="proseLabels(scan, claims, vocabulary)" expected="1" reason="the claims report reads the labels in prose" -->

- **A label in prose** is a label of the vocabulary, exact in case, written
  as a word of its own in a claims file outside code, comments and front
  matter, or as a code span that holds it and is no claim's own text. A
  claim's opening span is its label, and a second span in its own words is
  `mixed-labels` already, so neither is counted.
- **The report closes with a note** of how many there are, and under
  `--verbose`, which `claims` now takes, with each one's `file:line:column`
  and label. JSON lists them as `prose`, a field added, so `formatVersion`
  stays 1. SARIF and the annotations carry findings, and none of these.
- **A note, not a finding**, because such a word is as often a sentence's
  own, "it is Implemented in round 3", and a finding would fail a run on
  prose nobody meant as a claim. The note lets a reader see what the check
  does not hold, and decide.

## Amended 2026-11-11: what in force means is the configuration's

A directive under a claim is evidence only in a document in force, and
Spec Kit writes every specification `Draft`: each `Implemented` requirement
was `unevidenced-claim` with its test counted right under it. `claims` now
reads `"ignoreStatus"` as a run does
([ADR-0010](0010-spec-status.md#amended-2026-11-11-documents-whose-status-is-not-read),
amended the same day), and takes `--ignore-status` and `--no-ignore-status`,
which it refused, so the command line overrides the configuration here as
everywhere else.

- **`true`**, or `--ignore-status`, proves the directives under every claim
  whatever its document's status.
- **A list of spec patterns** reads the documents it matches with no
  status, so they are in force and the directives under their claims are
  proved.
- **Nothing**, `false` or `--no-ignore-status`: a directive in a document
  not in force is no evidence, and the finding says so, as before.
