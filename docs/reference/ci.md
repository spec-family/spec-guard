# CI integration

A job that runs the specs on every push and pull request, the ripgrep it can
use, a pre-commit hook, and the three formats that place findings on a pull
request or a merge request.

## A job

```yaml
# .github/workflows/specs.yml
name: Specs
on:
  push:
    branches: [main]
  pull_request:

jobs:
  spec-guard:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: '22'
      - run: npm ci
      - run: npx --no-install @spec-family/spec-guard "docs/**/*.md" "README.md" --verbose
```

The actions are pinned to commits, with the version beside each, because a tag
can be moved and a commit cannot; Dependabot's `github-actions` updates keep
pins like these current.

spec-guard is pinned the same way, by the lockfile: `npm ci` installs the
version it names, and `--no-install` behind the package's
[full name](../../README.md#names) stops the job where that install is
missing, rather than fetching another. A
repository with no JavaScript of its own keeps a `package.json` with
`"private": true` and spec-guard as its only `devDependencies` entry, and
commits the lockfile.

## ripgrep

That job needs nothing else installed. GitHub-hosted runners do **not** ship
ripgrep on `PATH` - `--json` reports `"engine": "javascript"` there - so the
fallback is what actually runs, and it produces identical results. If your
repository is large enough that you want ripgrep's speed, install it first:

```yaml
      - run: sudo apt-get update && sudo apt-get install -y ripgrep
```

Elsewhere, install the package your image or machine has, before spec-guard
runs:

| Where | Install |
| --- | --- |
| GitHub-hosted Ubuntu runner | `sudo apt-get update && sudo apt-get install -y ripgrep` |
| GitLab runner, Debian or Ubuntu image (`node:22`) | `apt-get update && apt-get install -y ripgrep` in `before_script` |
| GitLab runner, Alpine image (`node:22-alpine`) | `apk add --no-cache ripgrep` in `before_script` |
| Windows | `winget install BurntSushi.ripgrep.MSVC` |

spec-guard looks for `rg` on `PATH`. `SPEC_GUARD_RG=/path/to/rg` names the
binary instead, for one that is not on `PATH` or not called `rg`; set to
nothing, it is as unset. Under the default `--engine auto`, a binary that
cannot be run leaves the built-in scanner to do the work, and the report's
engine says `javascript`. `--engine rg`, or `"engine": "rg"` in the
configuration, is ripgrep asked for, and a run that cannot have it is exit 2
before anything is searched, never a run on the scanner: where the variable
names a path that is not there, a file that is no program, or a program that
does not answer `--version` as ripgrep does, the line names the variable and
what it holds:

```text
spec-guard: SPEC_GUARD_RG is "/opt/tools/rg", which did not answer --version as ripgrep does, and the rg engine was asked for. Set it to the path of an rg that runs, or unset it to use the rg on PATH.
```

A program that runs and is not ripgrep fails each search `auto` hands it; the
scanner answers that search, and the report carries a warning for it.

## A pre-commit hook

As a pre-commit hook, in a project that installed it:

```bash
npx --no-install @spec-family/spec-guard "docs/**/*.md" --fail-fast
```

## Annotations on the pull request

`--format sarif` writes a SARIF 2.1.0 document, which GitHub turns into a
comment on the offending line:

```yaml
    permissions:
      contents: read
      security-events: write
      actions: read # only in a private repository
    steps:
      # ...checkout, setup-node and npm ci as above
      - run: npx --no-install @spec-family/spec-guard "docs/**/*.md" --format sarif > spec-guard.sarif || true
      - uses: github/codeql-action/upload-sarif@9b3254085494b55a0f7c4c2b3d2d52cc712ce370 # v4.39.1
        with:
          sarif_file: spec-guard.sarif
          category: spec-guard
```

Version 4 of the upload action is the current one; version 3 is deprecated in
December 2026. The job needs `contents: read` for its checkout and
`security-events: write` to upload, and in a private repository
`actions: read` as well. Only the job that uploads needs
`security-events: write`.

One alert per broken rule rather than per match - the thing that broke is the
rule - anchored on the first offending line, with the directive as a related
location because that is often where the fix goes. Alerts carry a fingerprint
derived from what the assertion is about rather than where its matches landed,
so inserting a line above a violation does not close the alert and open a new
one; a directive that cannot be read is known by the directive as written, not
by the message, which a release may word differently.

## GitHub and GitLab without an upload

Two formats need no upload step. `--format github` writes one GitHub Actions
workflow command per finding, which the job's log turns into an annotation on
the diff:

```text
::error file=src/a.ts,line=2,title=assert-absence::"Legacy" must not appear in src: expected no matches, found 2 (docs/adr/0004-legacy.md:12). fix the code, or the rule if the decision it records has changed
```

`--format gitlab` writes a
[GitLab Code Quality](https://docs.gitlab.com/ci/testing/code_quality/) report,
which a merge request shows beside its changes:

```yaml
spec-guard:
  script:
    - npm ci
    - npx --no-install @spec-family/spec-guard --format gitlab > gl-code-quality-report.json || true
  artifacts:
    reports:
      codequality: gl-code-quality-report.json
```

## The findings each format places

Every format places the same findings, and `prove` and `cites` write all three:

| Finding | GitHub | GitLab severity |
| --- | --- | --- |
| a failing assertion, on its first offending line or its directive | `error` | `critical` |
| a rule that survived `prove`, on its directive | `error` | `critical` |
| a ghost citation (`cites`), on its comment | `error` | `critical` |
| a directive that could not be read | `error` | `major` |
| a run or a proof under `--strict` that verified nothing (`nothing-verified`), on the first spec's first line | `error` | `major` |
| a `cites` check under `--strict` that read no source file (`nothing-read`), on the first spec's first line | `error` | `major` |
| a spec pattern that left a `cites` check under `--strict` without a family (`unread-family`), on the first spec's first line | `error` | `major` |
| a stale citation (`cites`) | `warning`; `error` under `--strict` | `minor`; `critical` under `--strict` |
| a rule `prove` could make no violation for | `notice` | `minor` |
| a document read differently from how it was written (`spec-warning`: a status that cannot be read, front matter or a block never closed), on its line | `warning` | `minor` |
| a file `cites` could read only in part (`unread-comments`), on its first line | `notice`; `error` under `--strict` | `info`; `major` under `--strict` |
| a document not in force, on its first line | `notice` | `info` |

A finding's GitLab `description`, and its GitHub message, is its message and
then its hint, the next action.

A GitLab issue's `fingerprint` is the SHA-256 of what the finding is about -
its rule, its file and its subject, such as the assertion, the id a comment
cites or the directive that cannot be read, as written - with a count for a
second finding of the same. It is never taken from the message, the hint or the
line: GitLab compares it across pipelines to tell a new finding from an old
one, and a message that holds a count, or a line moved down a page, would make
every open issue look fixed and a new one appear.

## No language server

**There is no language server, and that is a decision rather than a gap.**
spec-guard's claims are about a whole repository - "this symbol appears nowhere
in `src`" - and a language server is handed one buffer at a time. Answering a
repository-wide question on every keystroke means rescanning the tree on every
keystroke; the alternative is answering a smaller question and calling it the
same one. `--watch` re-evaluates this repository in milliseconds after a save
by re-executing only what the save affected, and a pre-commit hook closes the
rest of the gap, without a daemon, an extension per editor, or a protocol
version matrix.
