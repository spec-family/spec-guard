# Who depends on this? - `impact`

Before changing a file, the question after "which rules govern it" is "what
else does it reach". `spec-guard impact` reads the import graph backwards: for
each path, the files that import it, and the files that import those, with how
far each is and the import that takes it one step closer; then the rules in
force that govern the path or any of them:

```bash
spec-guard impact src/db/client.ts --depth 3
```

```text
src/db/client.ts
  4 files depend on it, 2 directly, up to 3 imports away
    1  src/app/service.ts  imports src/db/client.ts (line 2)
    1  src/db/index.ts     imports src/db/client.ts (line 1)
    2  src/app/cache.ts    imports src/app/service.ts (line 1)
    3  src/ui/view.tsx     imports src/app/cache.ts (line 1)

3 rules govern these files, from 1 document

  ADR-0001: Layers  (docs/adr/0001-layers.md)
    :3 @assert-layers  src must keep its layers in order, src/db < src/app < src/ui
      governs: src/db/client.ts, src/app/service.ts, src/db/index.ts, src/app/cache.ts, src/ui/view.tsx
    ...

3 imports could not be resolved, and may depend on these paths:
  src/ui/view.tsx:3  ./gone.js (names no file)
  src/ui/view.tsx:4  @/db (names no file)
  src/ui/view.tsx:7  import(name)
```

- **Followed**: relative JavaScript and TypeScript imports, by the table the
  cycle rule uses ([ADR-0011](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0011-layers-and-cycles.md)), and relative
  Python imports, which name a module beside the importing file.
- **Counted, not followed**: Go imports, Rust `use`s, C# `using`s and absolute
  Python imports name modules, and which file a module is depends on `go.mod`,
  the crate's module tree, the compiler or `sys.path`. A path in one of those
  languages says its dependents are not computed, rather than showing an empty
  list. A Python file is followed by its relative imports alone, and its
  headline says so: `no relative import in scope names it`, or `by relative
  imports` after a count, since an absolute import of it is not followed.
- **Listed, never guessed**: an import naming no file, an alias such as `@/db`,
  a dynamic `import(name)`. Any of them may depend on the path.

- **A directory** asks about every file under it.
- **`--depth <n>`** stops `n` imports away; cycles are safe.
- **`--ignore-status`** lists rules from documents not in force, which are
  otherwise counted, as `query` does.
- **`--json`** is versioned by `formatVersion`.
- **Exit 2** for a path that does not exist, and for a run of `impact` in which
  no spec matched, as `query` does: the dependents are still written, but "no
  rules" over no specs is nothing measured. `--allow-empty` asks for the
  dependents alone, and exits 0. A spec pattern that matched no file beside
  others that did is the same: the dependents and the rules that were read
  are written, and it is exit 2 unless `--allow-empty`.
- **The MCP server** answers the same question as `get_dependents`, with the
  same document.
[ADR-0018](https://github.com/spec-family/spec-guard/blob/main/docs/adr/0018-impact.md) has the table and what it leaves out.
