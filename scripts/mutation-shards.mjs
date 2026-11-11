/**
 * The full mutation sweep, split across parallel CI jobs and put back together
 * as one report with one score.
 *
 * One hosted runner stopped finishing the sweep reliably: 42m39s on f83a743
 * against a 45-minute job limit, and the same source on a slower runner was on
 * pace for about 49. ADR-0003 ("0.9.0: the sweep in parallel shards") has
 * the measurements behind the split, and its "0.12.0: eight shards" section
 * those behind the table below.
 *
 * Each shard runs Stryker with stryker.shard.config.mjs, which takes `mutate`
 * from mutateFor() and switches the break threshold off, because a shard is
 * not a score. The merge refuses anything that is not exactly one sweep: a
 * missing shard, a file mutated twice or by the wrong shard, a shard that ran
 * with other patterns, shards that ran different tests. It then scores the
 * merged report with the library Stryker's own gate uses, and compares it the
 * way that gate does.
 *
 *   node scripts/mutation-shards.mjs toolchain
 *   node scripts/mutation-shards.mjs cache <shard>
 *   node scripts/mutation-shards.mjs merge <directory holding the shard reports>
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Stryker's own dependency, not a direct one of this package, and deliberately
// so: the merged score must be computed by the same code as the gate it
// replaces, and a separately pinned copy could drift from it.
import { calculateMutationTestMetrics } from 'mutation-testing-metrics';

// Minutes each file took in three full sweeps on vitest 5, read off the
// shards' logs with scripts/mutation-timeline.mjs: main's of b659668 and
// 3e616be (runs 42750234431 and 42971082810), and one of the same source
// with an earlier table of this file (run 43044744456):
//
//   polyglot 15.9 12.2 8.4    glob 11.5 12.2 9.7    comments 10.1 8.0 6.6
//   runner 10.0 10.2 13.2     cli 9.9 14.8 11.5     imports 9.8 9.6 9.9
//   engine 9.3 8.6 11.2       reporter 7.2 5.1 7.2  cites 6.1 4.7 6.6
//   graph 5.4 5.3 4.2         watch 3.9 3.4 3.5     parser 3.7 3.3 5.5
//   config 1.5 1.1 1.5        text 1.4 1.6 1.5      mcp 1.4 1.4 1.2
//   specs 1.3 1.1 1.3         structure 1.1 1.1 0.9 scope 0.6 0.6 0.4
//   the twelve files of the last 8.3 10.6 10.4
//
// About 115 to 118 minutes in all each time, and a file by as much as half
// from one sweep to the next: polyglot.ts took 15.9 minutes, then 12.2, then
// 8.4. Runners differ by a fifth or more, and cli.ts's static mutants are
// killed only by the long command test files, which a mutant runs last.
// glob.ts's timeouts disagree with its report's (16 in the report, 2 counted
// in its stretch), as they did in 0.12.0's sweep, so its minutes are the
// least certain; every shard's total is read off its own log.
//
// The table these replace put polyglot.ts, comments.ts and config.ts in one
// shard, which took 22m02s to 28m44s as a job over main's five sweeps on
// vitest 5, against the job's 30. The one below was searched for on the three
// sweeps at once: no shard takes more than 17.1 of these minutes in any of
// them, and the last, where a new file lands, 10.3 to 12.6. A file cannot be
// split, so no split of eight does much better.
//
// The last shard mutates everything else the base configuration mutates, so
// a file added later is still mutated without anyone remembering to list it
// here. The price is that new files all land in one shard, so it holds only
// small files and keeps room for them. When a shard's sweep passes 20
// minutes, re-measure and move files or add a shard (and add it to the
// workflow's matrix, which the merge checks). ADR-0003, amended 2026-11-11.
export const ASSIGNED = [
  ['src/polyglot.ts', 'src/structure.ts'], // 17.0 13.3 9.3
  ['src/comments.ts', 'src/cites.ts'], // 16.2 12.7 13.2
  ['src/engine.ts', 'src/graph.ts', 'src/text.ts'], // 16.1 15.5 16.9
  ['src/runner.ts', 'src/watch.ts'], // 13.9 13.6 16.7
  ['src/glob.ts', 'src/parser.ts'], // 15.2 15.5 15.2
  ['src/cli.ts', 'src/config.ts', 'src/specs.ts'], // 12.7 17.0 14.3
  ['src/imports.ts', 'src/reporter.ts'], // 17.0 14.7 17.1
]; // and the rest, mcp.ts and scope.ts among them: 10.3 12.6 12.0

export const SHARD_COUNT = ASSIGNED.length + 1;

export class ShardError extends Error {
  name = 'ShardError';
}

// Stryker's reading of `mutate`: patterns in order, a `!` pattern taking back
// what an earlier one matched. scripts/mutation-unmeasured.mjs reads the tree by
// it, so that what it counts is what a sweep mutates.
export function mutates(patterns, file) {
  let included = false;
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (path.posix.matchesGlob(file, pattern.slice(1))) included = false;
    } else if (path.posix.matchesGlob(file, pattern)) {
      included = true;
    }
  }
  return included;
}

export function checkAssignment(base, assigned = ASSIGNED) {
  const owners = new Map();
  assigned.forEach((files, index) => {
    const shard = index + 1;
    for (const file of files) {
      if (owners.has(file)) {
        throw new ShardError(`${file} is assigned to shards ${owners.get(file)} and ${shard}.`);
      }
      if (!mutates(base, file)) {
        throw new ShardError(
          `${file} is assigned to shard ${shard}, but the configuration does not mutate it (${base.join(', ')}).`,
        );
      }
      owners.set(file, shard);
    }
  });
  return owners;
}

function shardNumber(value, count) {
  const text = String(value);
  const shard = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!(shard >= 1 && shard <= count)) {
    throw new ShardError(`A shard is a number from 1 to ${count}, got "${text}".`);
  }
  return shard;
}

// Stryker keeps the verdicts an incremental file holds for files a run does
// not mutate, so that a partial run does not forget them. A shard started from
// the whole sweep's file would report every other shard's files too, with
// verdicts from the last sweep rather than this one. Each shard starts from
// its own part: every test, and only the files it mutates.
export function cacheFor(report, patterns) {
  return {
    ...report,
    files: Object.fromEntries(Object.entries(report.files).filter(([file]) => mutates(patterns, file))),
  };
}

export function mutateFor(base, shard, assigned = ASSIGNED) {
  const number = shardNumber(shard, assigned.length + 1);
  checkAssignment(base, assigned);
  return number <= assigned.length
    ? [...assigned[number - 1]]
    : [...base, ...assigned.flat().map((file) => `!${file}`)];
}

// To an incremental run a test is its file, its name and where it starts, and
// three packages decide those: Stryker's core matches the last sweep's tests
// to this run's, its vitest runner names each test and, since 10.1, says where
// it starts, and vitest gives the runner both. A test of the last sweep that
// the match misses is carried into the report as one that did not run this
// time, beside the test it was. Stryker 10.1.1 started from the file 10.0.0
// wrote, which has no locations, missed every test, and each shard's report
// held the suite twice (ADR-0003, amended 2026-11-08). So the incremental
// file is keyed on these three versions, and a run of any others restores
// none and tests every mutant.
export const TOOLCHAIN = ['@stryker-mutator/core', '@stryker-mutator/vitest-runner', 'vitest'];

export function toolchainKey(versionOf) {
  return TOOLCHAIN.map((name) => {
    const version = versionOf(name);
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+\S*$/.test(version)) {
      throw new ShardError(`No version of ${name} to key the incremental file on, got ${JSON.stringify(version)}: run npm ci first.`);
    }
    return `${name.replace('@stryker-mutator/', '')}-${version}`;
  }).join('+');
}

const installedVersion = (name) => {
  try {
    return JSON.parse(readFileSync(path.join('node_modules', name, 'package.json'), 'utf8')).version;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
};

// A test is its file and its name; ids are numbered afresh in every run.
const testKey = (file, name) => JSON.stringify([file, name]);

function testsOf(shard, report) {
  const tests = new Map();
  for (const [file, entry] of Object.entries(report.testFiles ?? {})) {
    for (const test of entry.tests) {
      const key = testKey(file, test.name);
      if (tests.has(key)) {
        throw new ShardError(
          `Shard ${shard} has two tests named "${test.name}" in ${file}, so its tests cannot be matched by name. A run started from an incremental file another Stryker or vitest wrote reports every test twice; see toolchainKey.`,
        );
      }
      tests.set(key, test);
    }
  }
  return tests;
}

const describeTest = (key) => {
  const [file, name] = JSON.parse(key);
  return `"${name}" in ${file}`;
};

const CARRIED =
  " A shard started from an incremental file that holds other shards' files reports their old verdicts as its own; see cacheFor.";

export function mergeReports(shards, { base, thresholds, assigned = ASSIGNED }) {
  const count = assigned.length + 1;
  const reports = new Map();
  for (const { shard, report } of shards) {
    if (!(Number.isInteger(shard) && shard >= 1 && shard <= count)) {
      throw new ShardError(`There are ${count} shards, but a report came from shard ${shard}.`);
    }
    if (reports.has(shard)) throw new ShardError(`Shard ${shard} reported twice.`);
    reports.set(shard, report);
  }
  const numbers = Array.from({ length: count }, (_, index) => index + 1);
  const missing = numbers.filter((shard) => !reports.has(shard));
  if (missing.length > 0) {
    throw new ShardError(
      `No report from shard ${missing.join(' or ')} of ${count}: the sweep is incomplete, and an incomplete sweep has no score.`,
    );
  }

  const owners = checkAssignment(base, assigned);
  const mutatedBy = new Map();
  for (const shard of numbers) {
    const report = reports.get(shard);
    const expected = mutateFor(base, shard, assigned);
    if (JSON.stringify(report.config?.mutate) !== JSON.stringify(expected)) {
      throw new ShardError(
        `Shard ${shard} ran with mutate ${JSON.stringify(report.config?.mutate)}, not ${JSON.stringify(expected)}.`,
      );
    }
    for (const file of Object.keys(report.files)) {
      if (mutatedBy.has(file)) {
        throw new ShardError(`${file} was mutated by shards ${mutatedBy.get(file)} and ${shard}.${CARRIED}`);
      }
      mutatedBy.set(file, shard);
      const owner = owners.get(file) ?? count;
      if (owner !== shard) throw new ShardError(`${file} belongs to shard ${owner}, but shard ${shard} reported it.${CARRIED}`);
    }
  }
  for (const [file, shard] of owners) {
    if (mutatedBy.get(file) !== shard) {
      throw new ShardError(
        `${file} is assigned to shard ${shard}, which reported no mutants in it. If it was renamed or removed, update ASSIGNED in scripts/mutation-shards.mjs.`,
      );
    }
  }

  // Stryker numbers tests afresh in every run, so an id means nothing outside
  // its own report. A test is its file and its name, and every shard must have
  // run the same ones, or the merge would be several sweeps rather than one.
  const reference = testsOf(1, reports.get(1));
  for (const shard of numbers.slice(1)) {
    const tests = testsOf(shard, reports.get(shard));
    const onlyFirst = [...reference.keys()].filter((key) => !tests.has(key));
    const onlyThis = [...tests.keys()].filter((key) => !reference.has(key));
    if (onlyFirst.length > 0 || onlyThis.length > 0) {
      throw new ShardError(
        `Shards 1 and ${shard} ran different tests: ${onlyFirst.length} only in shard 1, ${onlyThis.length} only in shard ${shard}, such as ${describeTest(onlyFirst[0] ?? onlyThis[0])}.`,
      );
    }
  }

  const ids = new Map();
  const testFiles = {};
  for (const [file, entry] of Object.entries(reports.get(1).testFiles ?? {})) {
    testFiles[file] = {
      ...entry,
      tests: entry.tests.map((test) => {
        const id = String(ids.size);
        ids.set(testKey(file, test.name), id);
        return { ...test, id };
      }),
    };
  }

  const files = {};
  let nextMutant = 0;
  for (const shard of numbers) {
    const report = reports.get(shard);
    const local = new Map();
    for (const [file, entry] of Object.entries(report.testFiles ?? {})) {
      for (const test of entry.tests) local.set(test.id, ids.get(testKey(file, test.name)));
    }
    const remap = (list) =>
      list.map((id) => {
        const unified = local.get(id);
        if (unified === undefined) throw new ShardError(`Shard ${shard} names test ${id}, which its report does not define.`);
        return unified;
      });
    for (const [name, file] of Object.entries(report.files)) {
      files[name] = {
        ...file,
        mutants: file.mutants.map((mutant) => ({
          ...mutant,
          id: String(nextMutant++),
          ...(mutant.coveredBy && { coveredBy: remap(mutant.coveredBy) }),
          ...(mutant.killedBy && { killedBy: remap(mutant.killedBy) }),
        })),
      };
    }
  }

  const first = reports.get(1);
  return {
    ...first,
    files: Object.fromEntries(Object.keys(files).sort().map((name) => [name, files[name]])),
    testFiles,
    thresholds,
    config: { ...first.config, mutate: base, thresholds },
  };
}

// The comparison MutationTestReportHelper.determineExitCode makes, on the
// unrounded score.
export function gate(report, thresholds) {
  const { metrics } = calculateMutationTestMetrics(report).systemUnderTestMetrics;
  const score = metrics.mutationScore;
  const formatted = score.toFixed(2);
  if (typeof thresholds.break !== 'number') {
    return { metrics, passed: true, message: `Final mutation score ${formatted}, with no break threshold configured.` };
  }
  return score < thresholds.break
    ? { metrics, passed: false, message: `Final mutation score ${formatted} under breaking threshold ${thresholds.break}.` }
    : { metrics, passed: true, message: `Final mutation score of ${formatted} is greater than or equal to break threshold ${thresholds.break}.` };
}

const COLUMNS = [
  ['% score', (m) => (Number.isNaN(m.mutationScore) ? 'n/a' : m.mutationScore.toFixed(2))],
  ['% covered', (m) => (Number.isNaN(m.mutationScoreBasedOnCoveredCode) ? 'n/a' : m.mutationScoreBasedOnCoveredCode.toFixed(2))],
  ['killed', (m) => String(m.killed)],
  ['timeout', (m) => String(m.timeout)],
  ['survived', (m) => String(m.survived)],
  ['no cov', (m) => String(m.noCoverage)],
  ['errors', (m) => String(m.runtimeErrors + m.compileErrors)],
];

// Full paths, sorted, because that is how the shards are assigned; the metrics
// tree drops the directory every file shares.
export function formatTable(report) {
  const metricsOf = (files) => calculateMutationTestMetrics({ ...report, files }).systemUnderTestMetrics.metrics;
  const rows = [
    ['All files', metricsOf(report.files)],
    ...Object.keys(report.files)
      .sort()
      .map((name) => [name, metricsOf({ [name]: report.files[name] })]),
  ];
  const cells = rows.map(([name, metrics]) => [name, ...COLUMNS.map(([, read]) => read(metrics))]);
  const header = ['File', ...COLUMNS.map(([title]) => title)];
  const widths = header.map((title, column) => Math.max(title.length, ...cells.map((row) => row[column].length)));
  const line = (row) => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[0]) : cell.padStart(widths[column]))).join(' | ');
  return [line(header), widths.map((width) => '-'.repeat(width)).join('-|-'), ...cells.map(line)].join('\n');
}

// The page Stryker's HTML reporter writes, less its logo. The report is a
// script expression, so every `<` is split out of its string as Stryker does,
// and no source text can close the <script> tag.
export function reportHtml(report, elementsScript) {
  const json = JSON.stringify(report).replace(/</g, '<"+"');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script>
${elementsScript}
</script>
</head>
<body>
<mutation-test-report-app titlePostfix="Stryker"></mutation-test-report-app>
<script>
const app = document.querySelector('mutation-test-report-app');
app.report = ${json};
function updateTheme() {
  document.body.style.backgroundColor = app.themeBackgroundColor;
}
app.addEventListener('theme-changed', updateTheme);
updateTheme();
</script>
</body>
</html>
`;
}

const minutes = (seconds) => `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, '0')}s`;

async function main(argv) {
  const [command, argument] = argv;
  if (command === 'toolchain' && argument === undefined) {
    try {
      console.log(toolchainKey(installedVersion));
      return 0;
    } catch (error) {
      if (!(error instanceof ShardError)) throw error;
      console.error(`${process.env.GITHUB_ACTIONS === 'true' ? '::error::' : ''}${error.message}`);
      return 1;
    }
  }
  if (!['cache', 'merge'].includes(command) || argument === undefined) {
    console.error('usage: node scripts/mutation-shards.mjs toolchain | cache <shard> | merge <directory holding the shard reports>');
    return 2;
  }
  const { default: config } = await import(pathToFileURL(path.resolve('stryker.config.mjs')).href);
  const incrementalFile = config.incrementalFile ?? 'reports/stryker-incremental.json';

  if (command === 'cache') {
    const patterns = mutateFor(config.mutate, argument);
    let report;
    try {
      report = JSON.parse(readFileSync(incrementalFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      console.log(`No incremental file at ${incrementalFile}: shard ${argument} tests every mutant.`);
      return 0;
    }
    const kept = cacheFor(report, patterns);
    writeFileSync(incrementalFile, JSON.stringify(kept));
    console.log(`Shard ${argument} starts from ${Object.keys(kept.files).length} of the ${Object.keys(report.files).length} files in ${incrementalFile}.`);
    return 0;
  }

  const directory = argument;

  const shards = [];
  const seconds = new Map();
  for (const entry of readdirSync(directory, { recursive: true })) {
    const file = path.join(directory, String(entry));
    const name = path.basename(file);
    const report = /^shard-(\d+)\.json$/.exec(name);
    const timing = /^shard-(\d+)\.timing\.json$/.exec(name);
    if (report) shards.push({ shard: Number(report[1]), report: JSON.parse(readFileSync(file, 'utf8')) });
    if (timing) seconds.set(Number(timing[1]), JSON.parse(readFileSync(file, 'utf8')).seconds);
  }

  let merged;
  try {
    merged = mergeReports(shards, { base: config.mutate, thresholds: config.thresholds });
  } catch (error) {
    if (!(error instanceof ShardError)) throw error;
    console.error(`${process.env.GITHUB_ACTIONS === 'true' ? '::error::' : ''}${error.message}`);
    return 1;
  }

  const lines = shards
    .sort((a, b) => a.shard - b.shard)
    .map(({ shard, report }) => {
      const mutants = Object.values(report.files).reduce((sum, file) => sum + file.mutants.length, 0);
      const took = seconds.has(shard) ? `, ${minutes(seconds.get(shard))}` : '';
      return `shard ${shard}: ${Object.keys(report.files).length} files, ${mutants} mutants${took}`;
    });
  const verdict = gate(merged, config.thresholds);
  console.log(`${lines.join('\n')}\n\n${formatTable(merged)}\n\n${verdict.message}`);

  const elements = readFileSync(fileURLToPath(import.meta.resolve('mutation-testing-elements/dist/mutation-test-elements.js')), 'utf8');
  const outputs = [
    ['reports/mutation/mutation.json', JSON.stringify(merged)],
    [config.htmlReporter?.fileName ?? 'reports/mutation/index.html', reportHtml(merged, elements)],
    [incrementalFile, JSON.stringify(merged, null, 2)],
  ];
  for (const [file, content] of outputs) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Mutation score: ${verdict.metrics.mutationScore.toFixed(2)}%\n\n${verdict.message}\n\n${lines.map((line) => `- ${line}`).join('\n')}\n\n`,
    );
  }
  return verdict.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
