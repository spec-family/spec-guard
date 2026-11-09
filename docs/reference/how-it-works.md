# How it works

A run is four stages, two of them pure: this page has the stages, then what a
run costs and why the two engines give one answer.

## The stages

```text
parser  ──▶ Directive[] ──▶ runner ──▶ Assertion[] ──▶ engine ──▶ AssertionResult[] ──▶ reporter
(pure)                      (I/O)                     (rg | js)                        (pure)
```

1. **Parse.** Markdown is scanned for `<!-- @assert-* -->` comments. Code -
   fenced and indented blocks, code spans, and the HTML elements whose content
   is not Markdown - and front matter are masked first, by the Markdown scanner
   every spec-* tool shares, so documentation that shows the syntax (like this
   reference) never executes it.
2. **Resolve.** Each directive becomes a typed assertion. Bad numbers, unknown
   booleans, unknown attributes and paths escaping `--root` are rejected here,
   before any I/O.
3. **Search.** Assertions that share a target list and flags are answered by a
   *single* pass over the tree.
4. **Report.** ANSI output with the spec location, the expectation, the observed
   count, and up to five real snippets; or JSON for tooling.

## Performance

Scanning a tree costs about the same whether you look for one symbol or twenty,
so spec-guard groups assertions by target set and flags and answers each group
in one pass.

`auto` then picks between the two engines **per search group**, because they
have different shapes of cost: ripgrep is dominated by process startup and
barely notices tree size, while the built-in scanner has no startup cost and
grows linearly. Starting a process to search a handful of files is a bad trade.
Re-measured for 0.4.0 on Windows 11 / Node 24, median of three, one symbol over
a synthetic tree:

| files | scanner | ripgrep | |
| --- | --- | --- | --- |
| 100 | **17 ms** | 214 ms | scanner, 12.9x |
| 500 | **70 ms** | 263 ms | scanner, 3.8x |
| 1,000 | 216 ms | **181 ms** | ripgrep, 1.2x |
| 3,000 | 735 ms | **222 ms** | ripgrep, 3.3x |
| 5,000 | 1,046 ms | **241 ms** | ripgrep, 4.3x |

The decision uses a bounded enumeration as its probe: spec-guard walks the
target set until it either finishes - in which case the file list is already in
hand and the scanner runs against it, with no process and no second walk - or
exceeds a budget, in which case ripgrep takes over. The crossover above, between
500 and 1,000 files, is one search on one Windows machine. On machines doing
nothing else it is a number of files set by what starting a process costs, and
about half as many when a run searches several targets at once, so the budget
is 32 files on Linux, 64 on macOS and 256 on Windows. `scripts/bench-engines.mjs`
reproduces this, and
[ADR-0004](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0004-adaptive-engine.md) has the full tables.

Treat single measurements from one machine with suspicion. On the development
machine used here, an absence assertion over 2,000 files measures 303 ms with
the scanner and 399 ms with ripgrep, but ripgrep's own spread across five runs
was 379-1039 ms - wide enough that the two are not really distinguishable at
that size. The order-of-magnitude differences at the ends of the table are the
part worth trusting.

0.5.0 added four language analysers, a scope probe on every assertion and a
baseline pass, so the obvious question is what that cost. Both versions were run
against the same synthetic 1,000-file tree, alternating rounds inside one
process so that this machine's load - which varies by a factor of two over a
session - falls on both equally:

| | median | min |
| --- | --- | --- |
| 0.4.0 | 908.8 ms | 493.7 ms |
| 0.5.0 | 913.4 ms | 496.6 ms |

0.5% apart, against a run-to-run spread far wider than that. The two versions
also returned identical counts for all five assertions, which is the more
useful half of the result.

0.5.1 replaced three hand-maintained "are these the same question" field lists
with one, and the surviving version serialises the exclude set where the old one
compared it by identity - a hot path made slower on purpose, so it was measured
rather than assumed. Same tree, same alternating rounds:

| | median | min |
| --- | --- | --- |
| 0.5.0 | 925.1 ms | 432.1 ms |
| 0.5.1 | 830.6 ms | 428.5 ms |

The medians are 10% apart and the minima are level, which is this machine's
noise band doing most of the talking - the honest reading is "no regression",
not "10% faster". The plausible mechanism for any real gain is that the runner
now groups by the engine's own definition of a shared pass, so a group of five
where two requests disagree is run as three and two rather than being refused
whole and run as five. Counts identical across all five assertions, again.

Two honest caveats:

- **The reported engine is the one that ran, not the one available.** On a small
  repository `--json` reports `"engine": "javascript"` even with ripgrep
  installed. That is the optimisation working, not a failure to find `rg`.
- **The engines are one implementation, not two that agree.** This used to say
  that ripgrep was the reference and the scanner merely matched it "on
  everything the test suite covers", with a note that the two treated
  `.gitignore` and ignored directories differently and that you should pin an
  engine if it mattered. It did matter: on a tree with eight copies of a symbol
  the scanner found two and ripgrep found four. Since 0.4.0 ripgrep answers only
  *which files contain this text*, and the scanner does all the counting,
  classification and reporting for both. `--engine` now changes how long a run
  takes and nothing about its verdict, and the suite asserts that on trees built
  from every case that used to split them. A regex rule kept two readings
  until its dialect was one, and ripgrep took a byte order mark off a file's
  start: `foo\b` over `fooé` was counted by the scanner and passed under
  ripgrep. What still splits them is a character newer than one of the two
  engines' Unicode
  ([ADR-0007](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0007-search-scope.md),
  amended 2026-11-08).
