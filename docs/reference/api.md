# Programmatic API

Each command is a function the package exports, and every read a run makes
goes through one interface a caller can replace.

```ts
import { runSpecGuard, formatReport } from '@spec-family/spec-guard';

const report = await runSpecGuard({
  patterns: ['docs/**/*.md'],
  root: process.cwd(),
});

if (!report.ok) {
  console.error(formatReport(report, { color: true, verbose: false }));
  process.exitCode = 1;
}
```

`runSpecGuard` returns the full report: every assertion, its bounds, the
observed count, match locations, warnings and timings. The parser
(`parseDirectives`) and reporter (`formatReport`, `formatJson`) are pure
functions you can use on their own.

A run reads the tree through one interface, `Io` - list a directory, `stat` a
path, read a file, resolve a real path - and `nodeIo` is the filesystem. Pass
your own as `io` and every read the run makes goes through it: finding and
reading the specs, checking targets exist, walking them, scanning files, reading
imports and listing directories. That is how to run the rules over a tree that
is not on disk, or not as the disk has it:

```ts
import { nodeIo, runSpecGuard, type Io } from '@spec-family/spec-guard';

// The disk, except for one file edited in memory.
const edited: Io = {
  ...nodeIo,
  readFile: async (file) =>
    file === '/repo/src/pay.ts' ? Buffer.from('new LegacyGateway();\n') : nodeIo.readFile(file),
};

const report = await runSpecGuard({ patterns: ['docs/**/*.md'], root: '/repo', io: edited });
```

ripgrep reads the disk itself, in a process of its own, so no `io` can reach
it: `engine: 'ripgrep'` with an `io` is an error, and `auto` with one searches
with the built-in scanner.

`proveSpecGuard` is `spec-guard prove` for a caller: it takes the options that
decide whether a rule passes, and an `io` too, and returns each rule's outcome
with the violations it was shown. `overlayIo` is the door it makes them behind,
and is there for a caller who wants to try a change of its own.

`findCitations` and `impactOf` are `spec-guard cites` and `spec-guard impact`,
and take an `io` as well; so do `loadRuleSet` and `queryRules`. Each command's
JSON is the report its function returns, with a `formatVersion` in front.

A process that reads the specs again for every request, as the MCP server
does, can keep what it parsed: pass one `createDocumentMemo()` as `documents`
to `runSpecGuard`, `loadRuleSet`, `queryRules` or `impactOf`, every time. Every
spec is still found and read, so an edit is seen by the next call; a document
whose bytes have not changed is not parsed again, and the memo holds only the
documents of the spec set read last. A single run gains nothing from one.
