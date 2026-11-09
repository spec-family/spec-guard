# Watch mode

A session that reports again whenever the tree changes, re-executing only the
rules a change can affect.

```bash
spec-guard --watch
```

Prints the report, then prints it again whenever something under the root
changes, until Ctrl+C. Saves are batched: a batch starts after 50 ms without a
new change, or 500 ms after its first. On a terminal the screen is redrawn;
otherwise each report is appended under the time. A change that no rule reads
updates the status line and nothing else:

```text
watching 15 specs · 1 change · 21 of 60 rules re-executed · 21 ms · Enter re-runs everything, Ctrl+C stops
```

A session re-executes only the rules whose directive or inputs changed:
- **Every filesystem read goes through one module**, so the session can record
  which rule read what.
- **A watcher's event only evicts what it may have changed**, and the evicted
  facts are read again and compared, so noise costs one directory read, and a
  renamed directory's contents need no events of their own.
- **Work that is a pure function of a file's bytes** - tokenizing, comment
  masking, scanning - is remembered by the bytes' hash.

Each of those is a way to report a tree that no longer exists, so a test
changes trees at random and requires every report a session gives to equal a
fresh run's, with six deliberately broken sessions that it has to catch.
[ADR-0014](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0014-configuration-and-watch.md)
has the design, the measurements and the limits.

On this repository, from a change to the report, in the quietest of four runs
(a plain warm run took 69 ms in it):

| Edit | Rules re-executed | Median |
| --- | --- | --- |
| a file in `src` | 21 of 60 | 21 ms |
| a test file | 1 of 60 | 3.3 ms |
| a file no rule reads | 0 | 2.0 ms |
| an ADR's prose | 0 | 2.4 ms |

The 15 ms this was built to is missed for a save in `src`, which re-executes the
two layer rules and every text rule over `src`; ADR-0014 says where the time
goes.

`--watch` scans in-process, where it can see what each rule reads, so it refuses
`--engine`, and `--json`, `--format json|sarif`, `--print-baseline`,
`--fail-fast` and `--allow-empty`, which each describe a single run. A spec
pattern that matches no file does not stop a session: it waits for one to
appear, and says which pattern that is under each report. It exits
130 when stopped, since a session is neither a pass nor a failure. What it
cannot see: a change the operating system never reports, a change behind a
symbolic link, and anything outside the root. CI stays the authority.
