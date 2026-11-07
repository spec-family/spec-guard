/**
 * `spec-guard claims`: each claim a specification labels, held to the evidence
 * its label asks for (ADR-0020). The documents are written to disk, since the
 * evidence is proved as `prove` proves a rule.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { claimsConfigError, ClaimsError, findClaimsReport, type ClaimsConfig } from '../src/claims.js';
import { makeTempRepo, removeTempRepo } from './helpers.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(removeTempRepo));
});

async function repo(files: Record<string, string>): Promise<string> {
  const root = await makeTempRepo(files);
  temporary.push(root);
  return root;
}

const CONFIG: ClaimsConfig = {
  files: ['spec/*.md'],
  labels: { Implemented: { evidence: 'test' }, Specified: {}, Target: {}, Hypothesis: { criterion: 'Criterion:' } },
  testPrefixes: ['fn test_'],
};

const CODE = { 'compiler/lib.rs': 'fn test_spec_hash() {}\nfn verify() { raise("E0501 [Totality Error]") }\n' };

const count = (symbol: string, indent = '  '): string => `${indent}<!-- @assert-count target="compiler" symbol="${symbol}" min="1" -->`;

describe('a claim whose label asks for a test', () => {
  it('holds where a directive under it names a test that prove shows can fail', async () => {
    const root = await repo({ ...CODE, 'spec/a.md': ['- `Implemented`: a field changes the hash.', count('fn test_spec_hash'), ''].join('\n') });
    const report = await findClaimsReport({ root, config: CONFIG });
    expect(report.ok).toBe(true);
    expect(report.claims).toEqual([{ file: 'spec/a.md', line: 1, label: 'Implemented', evidence: ['spec/a.md:2'] }]);
    expect(report.findings).toEqual([]);
    expect(report.totals).toEqual({ Implemented: 1, Specified: 0, Target: 0, Hypothesis: 0 });
    expect(report.files).toEqual(['spec/a.md']);
  });

  it('fails with no directive naming a test, a token check among them, and says what it looked for', async () => {
    const root = await repo({
      ...CODE,
      'spec/a.md': ['- `Implemented`, a token check: raises E0501.', count('E0501 [Totality Error]'), '- `Implemented`: nothing at all.', ''].join('\n'),
    });
    const report = await findClaimsReport({ root, config: CONFIG });
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => [f.line, f.rule, f.message])).toEqual([
      [1, 'unevidenced-claim', '`Implemented` needs a test, and no directive under the claim names one (fn test_)'],
      [3, 'unevidenced-claim', '`Implemented` needs a test, and no directive under the claim names one (fn test_)'],
    ]);
    expect(report.findings[0]).toMatchObject({ file: 'spec/a.md', column: 3, label: 'Implemented' });
    expect(report.claims[0]?.evidence).toEqual([]);
  });

  it('counts no directive that names a test without needing one, or is no count', async () => {
    const root = await repo({
      ...CODE,
      'spec/a.md': [
        '- `Implemented`: an absence names a test.',
        '  <!-- @assert-absence target="compiler" symbol="fn test_spec_hash" -->',
        '- `Implemented`: a count of at most one.',
        '  <!-- @assert-count target="compiler" symbol="fn test_spec_hash" max="1" -->',
        '- `Implemented`: an expected count of one.',
        '  <!-- @assert-count target="compiler" symbol="fn test_spec_hash" expected="1" -->',
        '',
      ].join('\n'),
    });
    const report = await findClaimsReport({ root, config: CONFIG });
    expect(report.findings.map((f) => f.line)).toEqual([1, 3]);
    expect(report.claims[2]?.evidence).toEqual(['spec/a.md:6']);
  });

  it('fails where the test is not there yet, which prove cannot show failing, and says so', async () => {
    const root = await repo({ ...CODE, 'spec/a.md': ['- `Implemented`: a test not written.', count('fn test_not_written'), ''].join('\n') });
    const [finding] = (await findClaimsReport({ root, config: CONFIG })).findings;
    expect(finding?.message).toMatch(/^`Implemented` needs a test, and the directive naming one at line 2 is no evidence: prove could not show it failing: /);
  });

  it('fails where the document holding the directive is not in force', async () => {
    const root = await repo({ ...CODE, 'spec/a.md': ['# A', '', 'Status: Draft', '', '- `Implemented`: a field changes the hash.', count('fn test_spec_hash'), ''].join('\n') });
    const [finding] = (await findClaimsReport({ root, config: CONFIG })).findings;
    expect(finding?.message).toBe('`Implemented` needs a test, and the directive naming one at line 6 is no evidence: its document is not in force, so the rule is not run');
  });

  it('gives a directive to the innermost claim around it, and none to the claim above', async () => {
    const root = await repo({
      ...CODE,
      'spec/a.md': ['1. Hashes.', '   - `Implemented`: the outer claim.', '     - `Specified`: the inner claim.', count('fn test_spec_hash', '       '), ''].join('\n'),
    });
    const report = await findClaimsReport({ root, config: CONFIG });
    expect(report.findings.map((f) => [f.line, f.rule])).toEqual([[2, 'unevidenced-claim']]);
    expect(report.claims.map((c) => [c.line, c.label, c.evidence])).toEqual([
      [2, 'Implemented', []],
      [3, 'Specified', []],
    ]);
  });
});

describe('what else a label asks', () => {
  it('fails a claim that holds two labels, and a hypothesis that says not how it will be judged', async () => {
    const root = await repo({
      'spec/a.md': [
        '- `Specified`; the conversion is `Implemented`.',
        '- `Hypothesis`: agents write fewer guards.',
        '  - Criterion: a nested item is not the claim\'s own words.',
        '- `Hypothesis`: agents repair less. Criterion: the repair count.',
        '- `Specified`: one label.',
        '',
      ].join('\n'),
    });
    const report = await findClaimsReport({ root, config: CONFIG });
    expect(report.findings.map((f) => [f.line, f.rule, f.message])).toEqual([
      [1, 'mixed-labels', 'the claim says `Specified` and `Implemented`, and a claim holds one label'],
      [2, 'missing-criterion', '`Hypothesis` says how it will be judged, and the claim holds no "Criterion:"'],
    ]);
    expect(report.totals).toEqual({ Implemented: 0, Specified: 2, Target: 0, Hypothesis: 2 });
  });

  it('runs no proof where no claim needs one, and reads every document the files name', async () => {
    const root = await repo({ 'spec/a.md': '- `Specified`: one.\n', 'spec/b.md': '- `Target`: two.\n', 'docs/c.md': '- `Specified`: not named.\n' });
    const report = await findClaimsReport({ root, config: { ...CONFIG, files: ['spec/*.md', 'spec/none/*.md'] } });
    expect(report).toMatchObject({ ok: true, files: ['spec/a.md', 'spec/b.md'], unmatched: ['spec/none/*.md'] });
    expect(report.totals).toEqual({ Implemented: 0, Specified: 1, Target: 1, Hypothesis: 0 });
  });

  it('refuses documents that match no file, since no claim can be read', async () => {
    const root = await repo({ 'docs/a.md': '- `Specified`: one.\n' });
    await expect(findClaimsReport({ root, config: CONFIG })).rejects.toThrow(new ClaimsError('"claims.files" matched no file (spec/*.md), so no claim can be read'));
  });
});

describe('a claims entry in the configuration', () => {
  it('takes files, labels and testPrefixes', () => {
    expect(claimsConfigError(CONFIG)).toBeNull();
    expect(claimsConfigError({ files: ['spec/*.md'], labels: { Specified: {} } })).toBeNull();
  });

  it('refuses what no check could hold, naming it', () => {
    const cases: Array<[unknown, string]> = [
      [[], 'must be an object such as { "files": ["spec/*.md"], "labels": { "Implemented": { "evidence": "test" } }, "testPrefixes": ["fn test_"] }'],
      [{ ...CONFIG, file: ['x'] }, 'has an unknown key "file"; it takes files, labels, testPrefixes'],
      [{ ...CONFIG, files: [] }, 'needs "files" as a non-empty list of spec globs'],
      [{ ...CONFIG, files: ['spec/**.md'] }, expect.stringMatching(/^has an .* in "files"$/) as unknown as string],
      [{ ...CONFIG, labels: {} }, 'needs "labels" as an object of at least one label'],
      [{ ...CONFIG, labels: { ' Implemented': {} } }, 'has a label " Implemented" that no code span holds as written'],
      [{ ...CONFIG, labels: { 'Im`pl': {} } }, 'has a label "Im`pl" that no code span holds as written'],
      [{ ...CONFIG, labels: { Implemented: 'test' } }, 'has a label "Implemented" whose rule is not an object'],
      [{ ...CONFIG, labels: { Implemented: { proof: 'test' } } }, 'has a label "Implemented" with an unknown key "proof"; a label takes evidence, criterion'],
      [{ ...CONFIG, labels: { Implemented: { evidence: 'bench' } } }, 'has a label "Implemented" whose "evidence" is not "test"'],
      [{ ...CONFIG, labels: { Hypothesis: { criterion: ' ' } } }, 'has a label "Hypothesis" whose "criterion" is not text'],
      [{ ...CONFIG, testPrefixes: [] }, 'needs "testPrefixes" as a non-empty list of what a test\'s name starts with'],
      [{ files: ['spec/*.md'], labels: { Implemented: { evidence: 'test' } } }, 'needs "testPrefixes" for a label whose evidence is a test, such as ["fn test_"]'],
    ];
    for (const [value, said] of cases) expect(claimsConfigError(value), JSON.stringify(value)).toEqual(said);
  });
});
