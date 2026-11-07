/**
 * How `spec-guard claims` writes what it found: for a person, for a script,
 * for code scanning, and placed for GitHub and GitLab (ADR-0020).
 */

import { describe, expect, it } from 'vitest';

import type { ClaimsReport } from '../src/claims.js';
import { claimsAnnotations, formatClaims, formatClaimsJson, formatClaimsSarif, formatGithub, formatGitlab } from '../src/reporter.js';

const REPORT: ClaimsReport = {
  ok: false,
  root: '/r',
  totals: { Implemented: 2, Specified: 1 },
  claims: [
    { file: 'spec/a.md', line: 1, label: 'Implemented', evidence: [] },
    { file: 'spec/a.md', line: 3, label: 'Implemented', evidence: ['spec/a.md:4'] },
    { file: 'spec/a.md', line: 5, label: 'Specified', evidence: [] },
  ],
  findings: [{ rule: 'unevidenced-claim', file: 'spec/a.md', line: 1, column: 3, label: 'Implemented', message: 'M1', hint: 'H1' }],
  files: ['spec/a.md'],
  unmatched: ['spec/none/*.md', 'specs/*.md'],
  durationMs: 12,
  config: { file: '.spec-guard.json', applied: ['claims'], overridden: [] },
};
const HELD: ClaimsReport = { ...REPORT, ok: true, findings: [], unmatched: [], config: undefined };

describe('the report for a person', () => {
  it('says each finding with its hint, what matched nothing, the options, the totals and the verdict', () => {
    expect(formatClaims(REPORT, { color: false, verbose: false })).toBe(
      [
        'spec-guard claims 1 document',
        '',
        '✖ spec/a.md:1  M1  unevidenced-claim',
        '    hint: H1',
        '',
        '○ matched no file: spec/none/*.md, specs/*.md',
        '',
        'options from .spec-guard.json: claims',
        '',
        '3 claims: Implemented 2, Specified 1 · 12ms',
        '✖ 1 claim finding',
      ].join('\n'),
    );
  });

  it('says only the totals and that every claim holds, in ASCII where asked', () => {
    expect(formatClaims(HELD, { color: false, verbose: false, ascii: true })).toBe(
      ['spec-guard claims 1 document', '', '3 claims: Implemented 2, Specified 1 - 12ms', '+ every claim has the evidence its label asks for'].join('\n'),
    );
  });

  it('paints a finding red, its rule and hint dim, a held check green', () => {
    const painted = formatClaims(REPORT, { color: true, verbose: false });
    expect(painted).toContain('\u001b[1m\u001b[34mspec-guard claims\u001b[0m \u001b[2m1 document\u001b[0m');
    expect(painted).toContain('\u001b[31m\u001b[1m✖\u001b[0m spec/a.md:1  M1  \u001b[2munevidenced-claim\u001b[0m\n    \u001b[2mhint: H1\u001b[0m');
    expect(painted).toContain('\u001b[2m○ matched no file: spec/none/*.md, specs/*.md\u001b[0m');
    expect(painted).toContain('3 claims: Implemented 2, Specified 1\u001b[2m · \u001b[0m\u001b[2m12ms\u001b[0m');
    expect(painted.endsWith('\u001b[31m\u001b[1m✖ 1 claim finding\u001b[0m')).toBe(true);
    expect(formatClaims(HELD, { color: true, verbose: false }).endsWith('\u001b[32m✔ every claim has the evidence its label asks for\u001b[0m')).toBe(true);
  });
});

describe('the report for a script', () => {
  it('is a versioned document of the verdict, the totals, the claims, the findings and what was read', () => {
    expect(JSON.parse(formatClaimsJson(REPORT))).toEqual({
      formatVersion: 1,
      ok: false,
      totals: { Implemented: 2, Specified: 1 },
      claims: REPORT.claims,
      findings: REPORT.findings,
      files: ['spec/a.md'],
      unmatched: ['spec/none/*.md', 'specs/*.md'],
      config: { file: '.spec-guard.json', applied: ['claims'], overridden: [] },
      durationMs: 12,
    });
  });
});

describe('the report for code scanning and the forges', () => {
  it('is SARIF 2.1.0 with every rule, each finding on the claim\'s line, fingerprinted by file, rule and label', () => {
    const sarif = JSON.parse(formatClaimsSarif(REPORT, { version: '9.9.9' }));
    expect(sarif.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json');
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].tool.driver).toEqual({
      name: 'spec-guard claims',
      informationUri: 'https://github.com/spec-family/spec-guard',
      version: '9.9.9',
      rules: [
        { id: 'unevidenced-claim', name: 'unevidenced-claim', shortDescription: { text: 'A claim whose label asks for a test has no directive under it that names one and can be shown to fail.' } },
        { id: 'mixed-labels', name: 'mixed-labels', shortDescription: { text: 'A claim holds more than one label.' } },
        { id: 'missing-criterion', name: 'missing-criterion', shortDescription: { text: 'A claim whose label asks how it will be judged does not say.' } },
      ],
    });
    const [result] = sarif.runs[0].results;
    expect(result).toMatchObject({ ruleId: 'unevidenced-claim', level: 'error', message: { text: 'M1\nH1' } });
    expect(result.locations[0].physicalLocation).toMatchObject({ artifactLocation: { uri: 'spec/a.md' }, region: { startLine: 1, startColumn: 3 } });
    const moved = JSON.parse(formatClaimsSarif({ ...REPORT, findings: [{ ...REPORT.findings[0]!, line: 9, message: 'M2' }] })).runs[0];
    expect(moved.results[0].partialFingerprints).toEqual(result.partialFingerprints);
    expect(moved.tool.driver.version).toBe('0.0.0');
    const other = JSON.parse(formatClaimsSarif({ ...REPORT, findings: [{ ...REPORT.findings[0]!, label: 'Target' }] })).runs[0];
    expect(other.results[0].partialFingerprints).not.toEqual(result.partialFingerprints);
  });

  it('places each finding as an error for GitHub and a critical issue for GitLab', () => {
    expect(claimsAnnotations(REPORT)).toEqual([
      { rule: 'unevidenced-claim', identity: ['unevidenced-claim', 'spec/a.md', 'Implemented'], level: 'error', severity: 'critical', file: 'spec/a.md', line: 1, message: 'M1', hint: 'H1' },
    ]);
    expect(formatGithub(claimsAnnotations(REPORT))).toMatch(/^::error file=spec\/a\.md,line=1,title=unevidenced-claim::M1/);
    expect(JSON.parse(formatGitlab(claimsAnnotations(REPORT)))[0]).toMatchObject({ check_name: 'unevidenced-claim', severity: 'critical' });
    expect(claimsAnnotations(HELD)).toEqual([]);
  });
});
