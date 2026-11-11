# Configuration

The options that are a project's policy can live in `package.json`, under
`"specGuard"`, so CI, a pre-commit hook and the MCP server an agent starts all
hold the same rules the same way:

```json
{
  "specGuard": {
    "specs": ["docs/**/*.md", "README.md"],
    "strict": true
  }
}
```

A root with no `package.json` - a Rust, Go or .NET repository, say - keeps the
same options, at the top level, in `.spec-guard.json`:

```json
{
  "specs": ["docs/**/*.md"],
  "exclude": ["target", "bin", "obj"]
}
```

| Key | Command line | Value |
| --- | --- | --- |
| `specs` | patterns, `--spec` | a non-empty array of globs |
| `exclude` | `--exclude` | an array of paths, gitignore-style, left out of every assertion that takes `exclude`; no `!`, `..`, drive path or root |
| `engine` | `--engine` | `"auto"`, `"rg"` or `"js"` |
| `strict`, `allowMissingTargets`, `allowEmptyScope`, `includeSpecs`, `defaultSkips` | the flag of that name | `true` or `false` |
| `ignoreStatus` | `--ignore-status`, `--no-ignore-status` | `true` or `false`, or a non-empty array of spec globs whose documents are read with no status, in force ([document status](document-status.md#documents-whose-status-means-nothing)) |
| `comments` | none | an object from an extension (`".dsl"`) or a file name (`"LICENSE-MIT"`) to a comment profile ([comments](attributes.md#comments---the-note-about-a-deletion-is-not-the-deletion)) |
| `maxSnippets` | `--max-snippets` | an integer, 0 or more |
| `concurrency` | `--concurrency` | an integer, 1 or more |
| `claims` | none; `spec-guard claims` reads it | `{ "files": [...], "labels": { "<label>": { "evidence"?: "test", "criterion"?: "<text>" } }, "testPrefixes"?: [...] }` ([claims](claims.md)) |
| `cites` | none; `spec-guard cites` reads it | a non-empty array of `{ "id": "ADR-{n}", "files": "docs/adr/{n}-*.md" }`, and no other key |

- **Only the root's files** are read: the `--root` directory, or the working
  directory. Nothing is inherited from a parent directory.
- **One of the two, not both.** Options in `package.json` and in
  `.spec-guard.json` are exit 2, since whichever lost would be options somebody
  wrote and nothing reads. A `package.json` with no `"specGuard"` is fine beside
  a `.spec-guard.json`.
- **The command line wins, both ways.** Patterns replace `specs`, `--exclude`
  replaces `exclude`, and `--no-strict` beats `"strict": true`.
- **`exclude` is for what no rule should read**, such as build output, which can
  turn a scan of 3,000 files into one of 37,000. It is added to each directive's
  own `exclude`, and applies to a query as it does to a run. `@assert-present`
  names its files and is unaffected. A rule's description names only its own
  exclusions; the project's appear in the options line below.
- **A malformed configuration is exit 2, before anything runs**, naming the file
  and the key: an unknown key, `"true"` where `true` goes, an option that
  belongs to one invocation, such as `format` or `verbose`, or an exclude
  pattern that can never exclude anything:

  ```text
  spec-guard: .spec-guard.json: "exclude" has an invalid exclude pattern "!build/generated/needed.ts": negation patterns are not supported in exclude.
  ```
- **Every report says what it took from the file**: a line above the summary
  such as `options from .spec-guard.json: specs, exclude (target, bin, obj)`,
  and a `config` field in JSON. `exclude` is named with its patterns, and
  exclusions given only on the command line get a line of their own,
  `exclude from the command line: dist`. JSON always carries the patterns in
  force as `exclude`, an empty list when there are none. An option nobody can see
  should never decide a result.
- `query` applies what a query reads, and the MCP server reads the file again
  for every request. Both tools' answers carry the options line, and their
  structured content carries `exclude` and `config`.
