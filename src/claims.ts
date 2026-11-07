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

import { nodeIo, readText, type Io } from './io.js';
import { proveSpecGuard } from './prove.js';
import { readSpecs, specPath } from './specs.js';
import type { ConfigUse, Directive, ProveResult } from './types.js';
import { claimsIn, type ListItem, type MarkdownScan } from './parser.js';
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
  readonly allowMissingTargets?: boolean;
  readonly allowEmptyScope?: boolean;
  readonly io?: Io;
}

/** A configuration no answer can be trusted under: the report is not written, and the command exits 2. */
export class ClaimsError extends Error {}

/** The items nested under `item`, which hold their own words. */
function nestedUnder(items: readonly ListItem[], item: ListItem): ListItem[] {
  return items.filter((other) => other.start > item.start && other.end <= item.end);
}

/** The item's own text, less what is nested under it, read from the structure mask. */
function ownText(scan: MarkdownScan, item: ListItem): string {
  let text = '';
  let at = item.textStart;
  for (const nested of nestedUnder(scan.listItems, item)) {
    if (nested.start < at) continue;
    text += scan.masks.structure.slice(at, nested.start);
    at = nested.end;
  }
  return text + scan.masks.structure.slice(at, item.end);
}

/** Whether a directive's symbol names a test and its bounds need one to be there. */
function namesTest(directive: Directive, prefixes: readonly string[]): boolean {
  if (directive.kind !== 'assert-count') return false;
  const symbol = directive.attributes['symbol'] ?? '';
  const least = Math.max(Number(directive.attributes['min'] ?? 0), Number(directive.attributes['expected'] ?? 0));
  return least >= 1 && prefixes.some((prefix) => symbol.startsWith(prefix));
}

/** What the report says of a directive that names a test and is no evidence, by what `prove` found of it. */
function whyNot(proof: ProveResult | undefined): string {
  if (proof === undefined) return 'its document is not in force, so the rule is not run';
  if (proof.outcome === 'survived') return 'prove made a change that should fail it and it still passed';
  return `prove could not show it failing: ${proof.unprovable ?? 'no violation could be made'}`;
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
  const prefixes = config.testPrefixes ?? [];
  const set = await readSpecs(config.files, root, io);
  const unmatched = set.unmatched ?? [];
  if (set.files.length === 0) {
    throw new ClaimsError(`"claims.files" matched no file (${config.files.join(', ')}), so no claim can be read`);
  }

  type Pending = { entry: Omit<ClaimEntry, 'evidence'>; candidates: Directive[]; rule: ClaimLabelRule; text: string; column: number };
  const pending: Pending[] = [];
  const findings: ClaimFinding[] = [];
  for (const document of set.documents) {
    const source = await readText(io, document.file);
    const { claims, scan } = claimsIn(source, vocabulary);
    // The innermost claim around a directive is the one it is written under.
    const owner = (directive: Directive): number => {
      const offset = scan.index.lineStart(directive.location.line) + directive.location.column - 1;
      let found = -1;
      claims.forEach((claim, index) => {
        if (claim.item.start <= offset && offset < claim.item.end && (found === -1 || claim.item.start > claims[found]!.item.start)) found = index;
      });
      return found;
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
      pending.push({ entry, candidates: under[index]!.filter((directive) => namesTest(directive, prefixes)), rule, text: ownText(scan, claim.item), column });
    });
  }

  // Proved once for every document, and only where some claim needs it.
  const asked = pending.some((claim) => claim.rule.evidence === 'test' && claim.candidates.length > 0);
  const proofs = new Map<string, ProveResult>();
  if (asked) {
    const proved = await proveSpecGuard({
      patterns: config.files,
      root,
      io,
      ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
      ...(options.defaultSkips === undefined ? {} : { defaultSkips: options.defaultSkips }),
      ...(options.comments === undefined ? {} : { comments: options.comments }),
      ...(options.allowMissingTargets === undefined ? {} : { allowMissingTargets: options.allowMissingTargets }),
      ...(options.allowEmptyScope === undefined ? {} : { allowEmptyScope: options.allowEmptyScope }),
    });
    for (const proof of proved.results) proofs.set(`${proof.location.relativeFile}:${proof.location.line}:${proof.location.column}`, proof);
  }

  const claims: ClaimEntry[] = [];
  for (const { entry, candidates, rule, text, column } of pending) {
    const proofOf = (directive: Directive): ProveResult | undefined =>
      proofs.get(`${directive.location.relativeFile}:${directive.location.line}:${directive.location.column}`);
    const evidence = rule.evidence === 'test' ? candidates.filter((directive) => proofOf(directive)?.outcome === 'killed') : [];
    claims.push({ ...entry, evidence: evidence.map((directive) => `${directive.location.relativeFile}:${directive.location.line}`) });
    if (rule.evidence === 'test' && evidence.length === 0) {
      const first = candidates[0];
      findings.push({
        ...entry,
        rule: 'unevidenced-claim',
        column,
        message:
          first === undefined
            ? `\`${entry.label}\` needs a test, and no directive under the claim names one (${prefixes.join(', ')})`
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
  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return {
    ok: findings.length === 0,
    root,
    totals,
    claims,
    findings,
    files: set.files.map((file) => specPath(root, file)),
    unmatched,
    durationMs: Math.round(performance.now() - started),
  };
}
