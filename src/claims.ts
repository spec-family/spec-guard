/**
 * `spec-guard claims`: what a specification says it does, held to its evidence.
 *
 * A specification marks each item with how far it holds - `` - `Implemented`:
 * the checker refuses a loop with no measure `` - and nothing held the mark to
 * anything: a label raised from `Specified` to `Implemented` by hand, with no
 * test behind it, passed every check. Here a label the configuration says
 * needs a test has one: a directive written under the claim, in force, whose
 * symbol names a test, and which `prove` shows can fail (ADR-0020).
 *
 * Which items are claims is spec-core's reading (`findClaims`), so that
 * spec-graph, which holds a checklist or a ledger to the claims it cites,
 * reads the same ones. The evidence is a directive, written as every other:
 * no syntax of its own.
 */

import path from 'node:path';

import { escapeRegExp } from './engine.js';
import { nodeIo, readText, type Io } from './io.js';
import { proveSpecGuard } from './prove.js';
import { elapsed } from './runner.js';
import { readSpecs, specPath } from './specs.js';
import type { ConfigUse, Directive, ProveResult } from './types.js';
import { claimsIn, type Claim, type ListItem, type MarkdownScan } from './parser.js';
import { patternListError, specPatternError } from './glob.js';

/** What a label asks of a claim that carries it. */
export interface ClaimLabelRule {
  /** `test`: a directive under the claim names a test, and can be shown to fail. */
  readonly evidence?: 'test';
  /** Text the claim's own words hold, such as `Criterion:`, where it says how it will be judged. */
  readonly criterion?: string;
}

/** The `claims` entry of a configuration. */
export interface ClaimsConfig {
  /** The documents whose list items are claims, as spec globs. */
  readonly files: readonly string[];
  /** The labels, in the order the report totals them, each with what it asks. */
  readonly labels: Readonly<Record<string, ClaimLabelRule>>;
  /** What a directive's symbol starts with when it names a test, such as `fn test_`. */
  readonly testPrefixes?: readonly string[];
}

const CONFIG_KEYS: readonly string[] = ['files', 'labels', 'testPrefixes'];
const RULE_KEYS: readonly string[] = ['evidence', 'criterion'];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * What is wrong with a `claims` entry, or null. Every key it does not take,
 * every label rule it does not know, and a label that asks for a test where
 * nothing says what a test is called, is refused rather than read as
 * nothing: each would be a claim no check holds.
 */
export function claimsConfigError(value: unknown): string | null {
  const shape = 'an object such as { "files": ["spec/*.md"], "labels": { "Implemented": { "evidence": "test" } }, "testPrefixes": ["fn test_"] }';
  if (!isObject(value)) return `must be ${shape}`;
  const unknown = Object.keys(value).find((key) => !CONFIG_KEYS.includes(key));
  if (unknown !== undefined) return `has an unknown key "${unknown}"; it takes ${CONFIG_KEYS.join(', ')}`;
  const files = value['files'];
  if (!Array.isArray(files) || files.length === 0 || !files.every(isText)) return `needs "files" as a non-empty list of spec globs`;
  const filesError = patternListError(files, specPatternError);
  if (filesError !== null) return `has an ${filesError} in "files"`;
  const labels = value['labels'];
  if (!isObject(labels) || Object.keys(labels).length === 0) return `needs "labels" as an object of at least one label`;
  let needsTests = false;
  for (const [label, rule] of Object.entries(labels)) {
    if (!isText(label) || label !== label.trim() || label.includes('`')) return `has a label "${label}" that no code span holds as written`;
    if (!isObject(rule)) return `has a label "${label}" whose rule is not an object`;
    const key = Object.keys(rule).find((name) => !RULE_KEYS.includes(name));
    if (key !== undefined) return `has a label "${label}" with an unknown key "${key}"; a label takes ${RULE_KEYS.join(', ')}`;
    if (rule['evidence'] !== undefined && rule['evidence'] !== 'test') return `has a label "${label}" whose "evidence" is not "test"`;
    if (rule['criterion'] !== undefined && !isText(rule['criterion'])) return `has a label "${label}" whose "criterion" is not text`;
    needsTests ||= rule['evidence'] === 'test';
  }
  const prefixes = value['testPrefixes'];
  if (prefixes !== undefined && (!Array.isArray(prefixes) || prefixes.length === 0 || !prefixes.every(isText))) {
    return `needs "testPrefixes" as a non-empty list of what a test's name starts with`;
  }
  if (needsTests && prefixes === undefined) return `needs "testPrefixes" for a label whose evidence is a test, such as ["fn test_"]`;
  return null;
}

export type ClaimRule = 'unevidenced-claim' | 'mixed-labels' | 'missing-criterion';

export interface ClaimFinding {
  readonly rule: ClaimRule;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly label: string;
  readonly message: string;
  readonly hint: string;
}

/**
 * A label of the vocabulary written where no claim reads it: in a sentence,
 * `(Implemented)`, in a heading or a table, or as a code span that opens no
 * list item. No check holds it, and the report says so in a note.
 */
export interface ProseLabel {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly label: string;
}

/** One claim, as the report lists it. */
export interface ClaimEntry {
  readonly file: string;
  readonly line: number;
  readonly label: string;
  /** Where each directive it counts as its evidence is, `file:line`. */
  readonly evidence: readonly string[];
}

export interface ClaimsReport {
  readonly ok: boolean;
  readonly root: string;
  /** The claims of each label, in the configuration's order; a label no claim carries is 0. */
  readonly totals: Readonly<Record<string, number>>;
  readonly claims: readonly ClaimEntry[];
  readonly findings: readonly ClaimFinding[];
  /** The labels of the vocabulary that stand in prose and are not claims, in document order. */
  readonly prose: readonly ProseLabel[];
  /** The documents read, root-relative. */
  readonly files: readonly string[];
  /** Patterns of `files` that matched nothing, as written. */
  readonly unmatched: readonly string[];
  readonly durationMs: number;
  /** What the command took from a configuration, as every report says. */
  readonly config?: ConfigUse | undefined;
}

export interface ClaimsOptions {
  readonly root: string;
  readonly config: ClaimsConfig;
  readonly exclude?: readonly string[];
  readonly defaultSkips?: boolean;
  readonly comments?: Readonly<Record<string, string>>;
  readonly io?: Io;
}

/** A configuration no answer can be trusted under: the report is not written, and the command exits 2. */
export class ClaimsError extends Error {}

/**
 * The item's own text, less the items nested under it, read from the
 * structure mask. Its children, one level down and inside it, lie apart and in
 * order, and each holds what is nested deeper. An item opens at its line's
 * content and ends before a terminator, where no other opens: `<` for the
 * first `<=` below and `>` for the `>=` answer alike, as does text begun with
 * anything, since a criterion is looked for in it and none is written so.
 */
function ownText(scan: MarkdownScan, item: ListItem): string {
  let text = '';
  let at = item.textStart;
  for (const child of scan.listItems) {
    if (child.depth !== item.depth + 1 || child.start <= item.start || child.start >= item.end) continue;
    text += scan.masks.structure.slice(at, child.start);
    at = child.end;
  }
  return text + scan.masks.structure.slice(at, item.end);
}

/**
 * Where a scanned document writes a label of the vocabulary that is no
 * claim's: as a word of its own in the text, exact in case, outside code,
 * comments and front matter, and as a code span that holds the label and is
 * no claim's own text. A claim's spans are its label and, where it holds
 * two, a finding of its own. Offsets, in document order.
 */
function proseLabels(scan: MarkdownScan, claims: readonly Claim[], vocabulary: readonly string[]): Array<{ offset: number; label: string }> {
  const found: Array<{ offset: number; label: string }> = [];
  const known = new Set(vocabulary);
  const claimed = new Set(claims.map((claim) => claim.item));
  for (const span of scan.codeSpans) {
    let run = 0;
    while (scan.text.charAt(span.start + run) === '`') run += 1;
    const label = scan.text.slice(span.start + run, span.end - run).trim();
    if (!known.has(label)) continue;
    // The innermost item around the span is the last of those around it to
    // open, and a span in a claim's own text is that claim's. No span opens
    // at an item's start, its indent or marker, nor at its end, a line's
    // terminator: `<` for the `<=` and `<=` for the `<` answer alike, and
    // those mutants are equivalent.
    const item = scan.listItems.findLast((candidate) => candidate.start <= span.start && span.start < candidate.end);
    if (item === undefined || !claimed.has(item)) found.push({ offset: span.start, label });
  }
  for (const label of vocabulary) {
    // The structure mask has code spans blanked, so none is counted twice.
    for (const match of scan.masks.structure.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(label)}(?![\\p{L}\\p{N}_])`, 'gu'))) {
      found.push({ offset: match.index, label });
    }
  }
  return found.sort((a, b) => a.offset - b.offset);
}

/**
 * Whether a directive counts a test: a symbol that starts as a test's name, and
 * a `min` or `expected` of at least 1. Only a count of a symbol takes both, so
 * no kind is asked.
 */
function namesTest(directive: Directive, prefixes: readonly string[]): boolean {
  const symbol = directive.attributes['symbol'];
  const least = Math.max(Number(directive.attributes['min'] ?? 0), Number(directive.attributes['expected'] ?? 0));
  return symbol !== undefined && least >= 1 && prefixes.some((prefix) => symbol.startsWith(prefix));
}

/** What the report says of a directive that counts a test and is no evidence, by what `prove` found of it. */
export function whyNot(proof: ProveResult | undefined): string {
  if (proof === undefined) return 'its document is not in force, so the rule is not run';
  if (proof.outcome === 'survived') return 'prove made a change that should fail it and it still passed';
  return `prove could not show it failing: ${proof.unprovable!}`;
}

/**
 * Reads the claims of the configured documents and holds each to what its
 * label asks. `prove` runs only where a label asks for a test and a claim
 * carrying it has a directive naming one: a proof is a run per rule.
 */
export async function findClaimsReport(options: ClaimsOptions): Promise<ClaimsReport> {
  const started = performance.now();
  const io = options.io ?? nodeIo;
  const root = path.resolve(options.root);
  const { config } = options;
  const vocabulary = Object.keys(config.labels);
  const where = (location: { readonly relativeFile: string; readonly line: number; readonly column: number }): string =>
    `${location.relativeFile}:${location.line}:${location.column}`;
  const set = await readSpecs(config.files, root, io);
  if (set.files.length === 0) {
    throw new ClaimsError(`"claims.files" matched no file (${config.files.join(', ')}), so no claim can be read`);
  }

  type Pending = { entry: Omit<ClaimEntry, 'evidence'>; candidates: Directive[]; rule: ClaimLabelRule; text: string; column: number };
  const pending: Pending[] = [];
  const findings: ClaimFinding[] = [];
  const prose: ProseLabel[] = [];
  for (const document of set.documents) {
    const source = await readText(io, document.file);
    const { claims, scan } = claimsIn(source, vocabulary);
    for (const { offset, label } of proseLabels(scan, claims, vocabulary)) {
      const { line, column } = scan.index.positionAt(offset);
      prose.push({ file: document.relativeFile, line, column, label });
    }
    // The innermost claim around a directive is the one it is written under,
    // and the last of those around it to open. A directive opens at its `<!--`,
    // never at an item's first or last offset, so `<` for the `<=` and `<=`
    // for the `<` answer alike, and so does a column two off.
    const owner = (directive: Directive): number => {
      const offset = scan.index.lineStart(directive.location.line) + directive.location.column - 1;
      return claims.findLastIndex((claim) => claim.item.start <= offset && offset < claim.item.end);
    };
    const under = claims.map((): Directive[] => []);
    for (const directive of document.directives) {
      const index = owner(directive);
      if (index !== -1) under[index]!.push(directive);
    }
    claims.forEach((claim, index) => {
      const column = scan.index.positionAt(claim.item.textStart).column;
      const entry = { file: document.relativeFile, line: claim.item.line, label: claim.label };
      if (claim.labels.length > 1) {
        findings.push({
          ...entry,
          rule: 'mixed-labels',
          column,
          message: `the claim says ${claim.labels.map((label) => `\`${label}\``).join(' and ')}, and a claim holds one label`,
          hint: 'split it into one item per label, each with what shows it holds',
        });
      }
      const rule = config.labels[claim.label]!;
      // A label that asks for a test has its prefixes: the configuration is refused without them.
      const candidates = rule.evidence === 'test' ? under[index]!.filter((directive) => namesTest(directive, config.testPrefixes!)) : [];
      pending.push({ entry, candidates, rule, text: ownText(scan, claim.item), column });
    });
  }

  // Proved once for every document, the first time a claim has a directive to
  // prove: a proof is a run per rule, and a check with none runs none.
  let proved: Promise<Map<string, ProveResult>> | undefined;
  const proofs = (): Promise<Map<string, ProveResult>> =>
    (proved ??= proveSpecGuard({ patterns: config.files, root, io, exclude: options.exclude, defaultSkips: options.defaultSkips, comments: options.comments }).then(
      (report) => new Map(report.results.map((proof) => [where(proof.location), proof])),
    ));

  const claims: ClaimEntry[] = [];
  for (const { entry, candidates, rule, text, column } of pending) {
    // A claim with nothing to prove runs no proof: tests hold that the code is not read then.
    const found = candidates.length === 0 ? new Map<string, ProveResult>() : await proofs();
    const proofOf = (directive: Directive): ProveResult | undefined => found.get(where(directive.location));
    const evidence = candidates.filter((directive) => proofOf(directive)?.outcome === 'killed');
    claims.push({ ...entry, evidence: evidence.map((directive) => `${directive.location.relativeFile}:${directive.location.line}`) });
    if (rule.evidence === 'test' && evidence.length === 0) {
      const first = candidates[0];
      findings.push({
        ...entry,
        rule: 'unevidenced-claim',
        column,
        message:
          first === undefined
            ? `\`${entry.label}\` needs a test, and no directive under the claim names one (${config.testPrefixes!.join(', ')})`
            : `\`${entry.label}\` needs a test, and the directive naming one at line ${first.location.line} is no evidence: ${whyNot(proofOf(first))}`,
        hint: 'write a directive under the claim that counts the test, as <!-- @assert-count target="..." symbol="fn test_..." min="1" -->, or lower the label',
      });
    }
    if (rule.criterion !== undefined && !text.includes(rule.criterion)) {
      findings.push({
        ...entry,
        rule: 'missing-criterion',
        column,
        message: `\`${entry.label}\` says how it will be judged, and the claim holds no "${rule.criterion}"`,
        hint: `say what would settle it, after "${rule.criterion}"`,
      });
    }
  }

  const totals: Record<string, number> = {};
  for (const label of vocabulary) totals[label] = claims.filter((claim) => claim.label === label).length;
  // Two files told apart by `<` are told apart by `<=`: the same file is the first answer.
  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return {
    ok: findings.length === 0,
    root,
    totals,
    claims,
    findings,
    prose,
    files: set.files.map((file) => specPath(root, file)),
    unmatched: set.unmatched!,
    durationMs: elapsed(started),
  };
}
