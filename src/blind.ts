/**
 * What an import rule could not have seen, though it may pass.
 *
 * Two ways a dependency rule matched nothing because it never looked where the
 * dependency is written, both found on real trees in round 29:
 *
 * - a TypeScript path alias, `@/db/client` under tsconfig `paths`. The import
 *   rules read no tsconfig (ADR-0005), so the alias stays a name no pattern on
 *   a path reaches, and `module="src/db/**"` passed over it;
 * - a pattern written as a path into the tree, `src/shop/infra/**`, held to
 *   files whose language names a module by something else: a Python package
 *   from its import root (`shop.infra.db` in a src layout), a Go package by its
 *   module path, a Rust module from `crate::`, a C# namespace.
 *
 * Each is said beside the rule, as a warning, and fails nothing yet: spec-core's
 * ADR-0009 holds what fails `--strict` until the format freeze ends, and the
 * flip is listed for that release. The C# layer that no using can reach is the
 * precedent, and fails already (ADR-0011).
 */

import path from 'node:path';

import { createExcludeMatcher } from './glob.js';
import { cannotBePackage, isGraphFile } from './graph.js';
import type { ModuleReference } from './imports.js';
import type { Io } from './io.js';
import { languageFor, normalizeModule, POLYGLOT_EXTENSIONS, type ModuleLanguage } from './polyglot.js';
import type { BlindSpot } from './types.js';

/** One reference in one file. */
export interface FileReference {
  file: string;
  reference: ModuleReference;
}

/** Whether a reference is a path alias: a name no package could have, in a file whose imports name files. */
export function isAlias(file: string, specifier: string): boolean {
  return isGraphFile(file) && cannotBePackage(specifier);
}

/**
 * What to write instead of an alias no pattern reached. A module pattern can
 * name it beside the path, as `module="src/db/**, @/db/**"`; a layer is one
 * pattern, so it names the folder wherever it sits, as `**\/db/**` does.
 */
function aliasHint(specifier: string, reached: 'pattern' | 'layer'): string {
  const [prefix, folder] = specifier.split('/');
  if (folder === undefined || folder === '') return 'import by a relative path, which the rule resolves';
  return reached === 'pattern'
    ? `name the alias as it is written as well, as "${prefix}/${folder}/**" does, or import by a relative path`
    : `write the layer to match the alias as well, as "**/${folder}/**" does, or import by a relative path`;
}

/**
 * The references written as a path alias that a rule matched to nothing, said
 * as one blind spot; null when there are none.
 */
export function aliasBlindSpot(aliases: readonly FileReference[], reached: 'pattern' | 'layer', maxSnippets: number): BlindSpot | null {
  const first = aliases[0];
  if (first === undefined) return null;
  const one = aliases.length === 1;
  return {
    rule: 'unresolved-alias',
    message: `${aliases.length} import${one ? ' is' : 's are'} written as a path alias, which spec-guard does not resolve, and ${one ? 'it reaches' : 'they reach'} no ${reached} of this rule, so where ${one ? 'it leads' : 'they lead'} was not checked`,
    hint: aliasHint(first.reference.specifier, reached),
    at: aliases.slice(0, maxSnippets).map(({ file, reference }) => `${file}:${reference.line} ${reference.specifier}`),
  };
}

const LANGUAGE_NAMES: Record<ModuleLanguage, string> = { python: 'Python', go: 'Go', rust: 'Rust', csharp: 'C#' };

/** A glob's syntax, which a segment that is a folder's name holds none of. */
const GLOB_SYNTAX = /[*?[\]{}!\\]/;

/**
 * The folder a pattern starts from at the root, or null when it does not
 * name one: a pattern of one segment matches a name anywhere, and one that
 * opens with a glob is no folder's name.
 */
export function leadingFolder(pattern: string): string | null {
  const written = pattern.replace(/^\.?\//, '');
  const slash = written.indexOf('/');
  if (slash <= 0 || slash === written.length - 1) return null;
  const folder = written.slice(0, slash);
  return GLOB_SYNTAX.test(folder) ? null : folder;
}

/** The literal segments of a pattern after its first, up to the first glob: `shop`, `infra` of `src/shop/infra/**`. */
function literalTail(pattern: string, after: number): string[] {
  const segments = pattern.replace(/^\.?\//, '').split('/').slice(after);
  const end = segments.findIndex((segment) => segment === '' || GLOB_SYNTAX.test(segment));
  return end === -1 ? segments : segments.slice(0, end);
}

/** How deep below a pattern's folder to look for code of a language, and how many folders at most. */
const LOOK_DEPTH = 3;
const LOOK_FOLDERS = 64;

/**
 * Whether the path a pattern starts with holds code of a language: a file of
 * it named so (`src/infra.rs`), or one in the folder or a little below. What
 * makes the pattern a name for that code by its path, rather than a module
 * name that happens to hold a slash (`net/http`) or code in another language.
 */
async function holdsLanguage(io: Io, root: string, prefix: string, language: ModuleLanguage): Promise<boolean> {
  const extensions = [...POLYGLOT_EXTENSIONS].flatMap(([extension, of]) => (of === language ? [extension] : []));
  const absolute = path.resolve(root, prefix);
  for (const extension of extensions) {
    if ((await io.stat(absolute + extension))?.isFile() === true) return true;
  }
  let level = [absolute];
  for (let depth = 0; depth < LOOK_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const directory of level.slice(0, LOOK_FOLDERS)) {
      const entries = await io.readDirectory(directory).catch(() => []);
      for (const entry of entries) {
        if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) return true;
        if (entry.isDirectory()) next.push(path.join(directory, entry.name));
      }
    }
    level = next;
  }
  return false;
}

/** Whether a reference names its module from somewhere, rather than from the importing file. */
function isAbsolute(reference: ModuleReference, language: ModuleLanguage): boolean {
  if (language === 'python') return !reference.specifier.startsWith('.');
  if (language === 'rust') return !/^(?:self|super)::/.test(reference.specifier);
  return true;
}

/** A path's or a module's names, lowercased: `shop`, `infra` of `Shop.Infra` and of `src/shop/infra/**`. */
function words(name: string): Set<string> {
  return new Set(name.toLowerCase().split(/[/.:]+/).filter((word) => word !== '' && !GLOB_SYNTAX.test(word)));
}

/**
 * The import to show beside a pattern: the one that shares the most names with
 * it, which is the dependency the pattern was most likely written for, the
 * first of them on a tie.
 */
function closest<T extends { module: string }>(pattern: string, imports: readonly [T, ...T[]]): T {
  const written = words(pattern);
  const shared = (entry: T): number => [...words(entry.module)].filter((word) => written.has(word)).length;
  return imports.reduce((best, entry) => (shared(entry) > shared(best) ? entry : best));
}

function languageHint(language: ModuleLanguage, pattern: string, folder: string): string {
  const tail = literalTail(pattern, 1);
  if (language === 'python') {
    const module = tail.join('.');
    return `a Python import names a module from its import root, which a src layout's folder is not part of: write the module as it is imported${module === '' ? '' : `, such as "${module}" if ${folder} is that root`}`;
  }
  if (language === 'go') return `a Go import names a package by its module path: start the pattern with **/, as "**/${literalTail(pattern, 0).join('/')}", or write the module path in full`;
  if (language === 'rust') {
    const segments = pattern.replace(/^\.?\//, '').split('/');
    const source = segments.indexOf('src');
    const module = source === -1 ? [] : literalTail(pattern, source + 1);
    return `Rust names a crate's own modules from crate::${module.length === 0 ? '' : `: write "crate::${module.join('::')}"`}`;
  }
  return 'a C# using names a namespace, never a folder: write the namespace as a using names it';
}

export interface ModulePathInput {
  file: string;
  references: readonly ModuleReference[];
}

/**
 * The patterns written as a path into the tree that the files of a language
 * naming modules by something else could not have matched.
 *
 * Said of a pattern and a language when every one of these holds, so that a
 * pattern written right is left alone: the pattern starts at a folder, files of
 * the language in scope make imports that name a module from somewhere, none
 * of those starts at the folder, the pattern matched none of the language's
 * references under any of its names, and the path it starts with holds code of
 * the language. For Python a folder holding an `__init__.py` is a package,
 * whose path is its module's name when the root is the import root, and is
 * left alone too.
 */
export async function modulePathBlindSpots(
  patterns: readonly string[],
  inputs: readonly ModulePathInput[],
  options: {
    languages: readonly ModuleLanguage[];
    includeTypes: boolean;
    /** Every name a reference is matched under, as the rule matches it. */
    names: (file: string, reference: ModuleReference) => readonly string[];
    describe: (patterns: readonly string[]) => string;
    io: Io;
    root: string;
  },
): Promise<BlindSpot[]> {
  const spots: BlindSpot[] = [];
  for (const language of options.languages) {
    const files = inputs.filter((input) => languageFor(input.file) === language);
    const absolute = files.flatMap(({ file, references }) =>
      references
        .filter((reference) => (options.includeTypes || !reference.typeOnly) && isAbsolute(reference, language))
        .map((reference) => ({ file, reference, module: normalizeModule(reference.specifier, file, language) })),
    );
    const [first, ...rest] = absolute;
    if (first === undefined) continue;

    const blind = new Map<string, string[]>();
    for (const pattern of patterns) {
      const folder = leadingFolder(pattern);
      if (folder === null) continue;
      if (absolute.some(({ module }) => module === folder || module.startsWith(`${folder}/`))) continue;
      const matches = createExcludeMatcher([pattern]);
      if (files.some(({ file, references }) => references.some((reference) => options.names(file, reference).some(matches)))) continue;
      if (language === 'python' && (await options.io.stat(path.resolve(options.root, folder, '__init__.py')))?.isFile() === true) continue;
      if (!(await holdsLanguage(options.io, options.root, literalTail(pattern, 0).join('/'), language))) continue;
      blind.set(folder, [...(blind.get(folder) ?? []), pattern]);
    }

    for (const [folder, written] of blind) {
      const one = files.length === 1;
      const name = LANGUAGE_NAMES[language];
      const example = closest(written[0]!, [first, ...rest]);
      spots.push({
        rule: 'module-path-pattern',
        message: `${options.describe(written)} ${written.length === 1 ? 'names' : 'name'} ${name} code by its path from ${folder}/, and the ${files.length} ${name} file${one ? '' : 's'} in scope import${one ? 's' : ''} by a module name that never starts there, such as "${example.reference.specifier}", so ${written.length === 1 ? 'it matches' : 'they match'} none of ${one ? 'its' : 'their'} imports`,
        hint: languageHint(language, written[0]!, folder),
        at: [],
      });
    }
  }
  return spots;
}

/** A blind spot as a run prints it among a rule's warnings. */
export function blindSpotWarnings(spots: readonly BlindSpot[]): string[] {
  return spots.flatMap((spot) => [`${spot.message} (${spot.hint})`, ...spot.at.map((entry) => `  ${entry}`)]);
}
