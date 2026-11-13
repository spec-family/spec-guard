# Can each rule fail? - `prove`

A passing rule says one of two things, and the report cannot tell which: the
code holds, or the rule cannot see the code. A `glob="*.js"` over a codebase
written in TypeScript passes, and would pass whatever the code did.

```bash
spec-guard prove
```

`prove` shows each rule in force a violation of itself and runs the rule over
it: a file holding the forbidden text beside the files the rule reads, a file
importing the forbidden module, two files importing each other, a file in a
lower layer importing a higher one, a misnamed file, a required entry or a
partner taken away, a file the rule requires removed. The violation is made **in
memory**, through the same door every read goes through. Nothing is written to
disk, and nothing touches git.

```text
spec-guard prove 3 specs · 12 rules

✖ docs/adr/0004-legacy.md:12  @assert-absence  passed with a violation in place
    "LegacyClient" must not appear in src
    maximum: added src/spec-guard-prove.ts holding "LegacyClient", beside the code under src, none of which the rule reads, and it still passed: expected no matches, found 0

○ docs/adr/0009-queue.md:8  @assert-absence  no violation could be made
    "enqueueRaw" must not appear in src/queue
    it fails on the tree as it stands (expected no matches, found 1), so no change can be shown to be what fails it

10 seen to fail · 1 survived · 1 unprovable · 1.10s
✖ 1 rule passed with a violation of itself in place
```

Each rule is **killed** (it failed on the violation), **survived** (it still
passed, and the violation is shown), or **unprovable** (no violation could be
made, and the reason is given). Both bounds of a count are probed, and a
regular expression's maximum twice: with its text at a file's start, and
below a line of prove's own, so a pattern whose `^` or `$` met only a file's
ends survives. `prove` exits 1 when a rule survived, and under `--strict`
when one is unprovable. It takes the run's `--root`, `--spec`, `--exclude`,
`--ignore-status`, `--json`, `--format sarif|github|gitlab` and
`--concurrency`, the rules proved at once (default 8), and the
configuration's specs, exclusions, strictness and concurrency. The report
lists the rules in the order the specs state them at any concurrency.

A kill means the rule can fail, not that it catches the way the code is
written: `module="src/db.ts"` is killed by `import 'src/db.ts'` though every
file imports `./db.js`. [ADR-0016](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0016-rules-seen-to-fail.md) has the
violations for each kind of rule, and what `unprovable` means.
