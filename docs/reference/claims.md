# Does each claim have its evidence? - `claims`

A specification marks what it says with how far it holds, and nothing held the
mark to anything:

```md
- `Implemented`: a refund over the captured amount is refused.
  <!-- @assert-count target="payments" symbol="fn test_refund_over_capture_is_refused" min="1" -->
- `Implemented`, as a token check only: raises `E0420 [Refund Error]`.
  <!-- @assert-count target="payments" symbol="E0420 [Refund Error]" min="1" -->
- `Hypothesis`: retries cut failed captures. Criterion: the failed-capture rate.
```

`spec-guard claims` holds each claim to what its label asks, from the
configuration:

```json
{
  "claims": {
    "files": ["spec/*.md"],
    "labels": {
      "Implemented": { "evidence": "test" },
      "Specified": {},
      "Hypothesis": { "criterion": "Criterion:" }
    },
    "testPrefixes": ["fn test_"]
  }
}
```

```text
x spec/refunds.md:3  `Implemented` needs a test, and no directive under the claim names one (fn test_)  unevidenced-claim
    hint: write a directive under the claim that counts the test, as <!-- @assert-count target="..." symbol="fn test_..." min="1" -->, or lower the label

3 claims: Implemented 2, Specified 0, Hypothesis 1 - 14ms
x 1 claim finding
```

- **A claim** is a list item that opens with a label as a code span, after a
  checkbox where there is one; a nested item is a claim of its own.
- **Its evidence** is a directive written under it. `"evidence": "test"` asks
  for an `@assert-count` whose `symbol` starts with one of `testPrefixes`,
  with a `min` or `expected` of at least 1, in a document in force, that
  [`prove`](prove.md) shows can fail. A count of an error
  string is no evidence of a test, and the finding says why a directive was
  not evidence: none named a test, its document is not in force, or prove
  could not show it failing.
- **`"ignoreStatus"`** in the configuration, which `claims` reads, decides
  what in force means here as it does for a run: `true`, or
  `--ignore-status`, proves the directives under every claim whatever its
  document's status, and a list of spec patterns reads the documents it
  matches with no status, so they are in force - for Spec Kit's
  specifications, which are all `Draft`
  ([document status](document-status.md#documents-whose-status-means-nothing)).
  `--no-ignore-status` reads every status.
- **`"criterion"`** asks for that text in the claim's own words.
- **One label per claim**: an item whose own words hold two is
  `mixed-labels`.
- **The totals** of each label are in the report and in JSON, never in a
  document.
- **A label in prose**, written where no claim reads it, `(Implemented)` in
  a sentence, a heading, a table cell or a code span that opens no item, is
  no claim, and no check holds it. The report closes with how many there
  are, `--verbose` says where, and JSON lists them as `prose`; they change
  no exit code.
- `--format json`, `sarif`, `github` and `gitlab`, as `cites`. No `claims`
  in the configuration, or `files` that match nothing, is exit 2.

Which item is a claim is spec-core's reading, which spec-graph reads too
([ADR-0020](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0020-a-claim-is-held-to-its-evidence.md)).
