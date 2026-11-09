/**
 * The order the mutation sweep runs a mutant's test files in
 * (vitest.mutation.config.ts): the file that failed last, then the quickest.
 *
 * The order asks vitest's cache what vitest's own sequencer asks it of each
 * file's last run. A question the cache stopped answering would find nothing,
 * every file would count as never run, and the sweep would quietly go by
 * size, at the cost the order was written to remove and with nothing failing.
 * So the questions are held here to those vitest's own sequencer asks, in the
 * version installed.
 *
 * Whether a file failed when the worker last ran it is the order's own
 * record, which a reporter keeps: vitest 5's cache keeps a failure from a
 * narrowed run until a run of the whole file passes. The record is held here
 * file by file and through vitest, in runs made as Stryker's runner makes
 * them.
 *
 * What the sweep reports is held here too, as vitest resolves it from the
 * same file.
 *
 * Not part of a mutation run: it tests nothing under `src/`, and no mutant is
 * under the order.
 */

import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseSequencer, type TestModule, type TestModuleState, type TestSpecification, type Vitest } from 'vitest/node';

import unitSuite from '../vitest.config.js';
import mutationSuite, { lastRun, QuickestFirst } from '../vitest.mutation.config.js';
import { makeTempRepo, removeTempRepo } from './helpers.js';

const ROOT = resolve(import.meta.dirname, '..');

// What a worker's cache holds for each file after it last ran it: this
// repository's two longest files and two of its shortest. The long ones take
// more milliseconds than the smallest file has bytes, so a file never run
// cannot pass for a quick one by its size.
type Timed = Record<string, { duration: number; failed: boolean }>;
const TIMED: Timed = {
  'tests/watch-equivalence.test.ts': { duration: 6_900, failed: false },
  'tests/glob-core.test.ts': { duration: 6_000, failed: false },
  'tests/scope.test.ts': { duration: 10, failed: false },
  'tests/text.test.ts': { duration: 8, failed: false },
};
// The files on the disk, by their bytes, which vitest 5 reads where a file
// has no time; two the worker has not run.
const SIZES: Record<string, number> = {
  'tests/watch-equivalence.test.ts': 41_000,
  'tests/glob-core.test.ts': 96_000,
  'tests/cli.test.ts': 14_000,
  'tests/scope.test.ts': 7_000,
  'tests/text.test.ts': 5_000,
  'tests/specs.test.ts': 4_000,
};
const FOUND = Object.keys(SIZES);

/**
 * The reporters vitest gives a run of a suite on a GitHub runner, where every
 * step has GITHUB_ACTIONS set to true, resolved by vitest itself from the
 * configuration file, as Stryker's runner has it resolve them: it names none
 * of its own. Vitest 5 reads the variable once, when it is first imported, so
 * the suite is resolved in a process started with it.
 */
function onARunner(name: string): string[] {
  const script = [
    "import { resolveConfig } from 'vitest/node';",
    `const { test } = await resolveConfig({ root: ${JSON.stringify(ROOT)}, config: ${JSON.stringify(join(ROOT, name))} });`,
    "const names = test.reporters.map((reporter) => (Array.isArray(reporter) ? String(reporter[0]) : 'inline'));",
    // On a line of its own, after anything vitest prints on the way.
    "process.stdout.write('\\nreporters ' + JSON.stringify(names));",
  ].join('\n');
  const env = { ...process.env, GITHUB_ACTIONS: 'true' };
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, env, encoding: 'utf8' });
  return JSON.parse(out.slice(out.lastIndexOf('\nreporters ') + '\nreporters '.length)) as string[];
}

describe("the order a mutant's test files run in", () => {
  // Files of those sizes, where both sequencers look for them, in a folder of
  // each test's own: the record is the module's, and a file it has not seen
  // is one no worker has run.
  let work = '';
  beforeEach(async () => {
    const files = Object.fromEntries(Object.entries(SIZES).map(([file, size]) => [file, 'x'.repeat(size)]));
    work = (await makeTempRepo(files)).replaceAll('\\', '/');
  });
  afterEach(() => removeTempRepo(work));

  // The order's own record, told of a file's end as vitest tells a reporter.
  const ended = (file: string, state: TestModuleState) => {
    lastRun.onTestModuleEnd({ moduleId: `${work}/${file}`, state: () => state } as unknown as TestModule);
  };
  // A run of every file the worker has timed, in which those named failed and
  // the rest passed.
  const ran = (failed: readonly string[]) => {
    for (const file of Object.keys(TIMED)) ended(file, failed.includes(file) ? 'failed' : 'passed');
  };

  const worker = (timed: Timed, found = FOUND) => {
    const asked: string[] = [];
    const ctx = {
      config: { root: work, shard: { index: 1, count: 2 } },
      cache: {
        getTestSpecificationResult: (file: TestSpecification) => {
          const key = file.moduleId.slice(work.length + 1);
          asked.push(key);
          return timed[key];
        },
      },
    } as unknown as Vitest;
    const files = found.map(
      (file) => ({ moduleId: `${work}/${file}`, project: { name: '', config: { isolate: true, sequence: { groupOrder: 0 } } } }) as unknown as TestSpecification,
    );
    return { ctx, files, asked };
  };
  const names = (files: TestSpecification[]) => files.map((file) => file.moduleId.slice(`${work}/tests/`.length).replace('.test.ts', ''));
  // The sweep's order, of the files as found and as found backwards: an order
  // that only kept what it was given would pass one of the two.
  const ours = async (timed: Timed, found = FOUND) => {
    const { ctx, files } = worker(timed, found);
    const order = names(await new QuickestFirst(ctx).sort(files));
    expect(names(await new QuickestFirst(ctx).sort([...files].reverse()))).toEqual(order);
    return order;
  };

  it('runs the quickest file first, and a file the worker has not timed after those it has, the smaller first', async () => {
    expect(await ours(TIMED)).toEqual(['text', 'scope', 'glob-core', 'watch-equivalence', 'specs', 'cli']);
  });

  it('runs a file that failed when the worker last ran it before any that passed, however long it takes, and of two that failed the quicker', async () => {
    ran(['tests/watch-equivalence.test.ts']);
    expect(await ours(TIMED)).toEqual(['watch-equivalence', 'text', 'scope', 'glob-core', 'specs', 'cli']);
    // A run of one file, which fails; the other has not run since it failed.
    ended('tests/scope.test.ts', 'failed');
    expect(await ours(TIMED)).toEqual(['scope', 'watch-equivalence', 'text', 'glob-core', 'specs', 'cli']);
  });

  it("takes no failure from vitest's cache, which keeps one from a narrowed run until a run of the whole file passes", async () => {
    // Every file passed when the worker last ran it, and the cache still has
    // the longest failed.
    ran([]);
    const kept = { ...TIMED, 'tests/watch-equivalence.test.ts': { duration: 6_900, failed: true } };
    expect(await ours(kept)).toEqual(['text', 'scope', 'glob-core', 'watch-equivalence', 'specs', 'cli']);
  });

  it("keeps a file's verdict through a run that skips it or does not reach it, until a run runs it", async () => {
    ran(['tests/scope.test.ts']);
    for (const state of ['skipped', 'pending', 'queued'] as const) ended('tests/scope.test.ts', state);
    ended('tests/text.test.ts', 'passed');
    expect(await ours(TIMED)).toEqual(['scope', 'text', 'glob-core', 'watch-equivalence', 'specs', 'cli']);
    ended('tests/scope.test.ts', 'passed');
    expect(await ours(TIMED)).toEqual(['text', 'scope', 'glob-core', 'watch-equivalence', 'specs', 'cli']);
  });

  it('differs from the order vitest would give in that alone, and asks the cache what vitest asks it', async () => {
    const failed = { ...TIMED, 'tests/scope.test.ts': { duration: 10, failed: true } };
    const timed = Object.keys(TIMED);
    ran(['tests/scope.test.ts']);

    // Vitest's own: the failed file, then the longest, which is why a mutant
    // that a short file kills waited for the long ones.
    const theirs = worker(failed, timed);
    expect(names(await new BaseSequencer(theirs.ctx).sort(theirs.files))).toEqual(['scope', 'watch-equivalence', 'glob-core', 'text']);
    const sweep = worker(failed, timed);
    expect(names(await new QuickestFirst(sweep.ctx).sort(sweep.files))).toEqual(['scope', 'text', 'glob-core', 'watch-equivalence']);

    // A question vitest's cache stopped answering would find nothing, every
    // file would count as never run, and the order would quietly be by size.
    expect(new Set(sweep.asked)).toEqual(new Set(theirs.asked));
    expect(new Set(sweep.asked)).toEqual(new Set(timed));
  });

  it('gives a shard of the suite the files vitest gives it', async () => {
    const { ctx, files } = worker(TIMED);
    const theirs = names(await new BaseSequencer(ctx).shard(files));
    expect(theirs).toHaveLength(3);
    expect(names(await new QuickestFirst(ctx).shard(files))).toEqual(theirs);
  });

  /**
   * Stryker's vitest runner as it runs one mutant after another, in a process
   * of its own: a vitest made from this configuration with the options the
   * runner gives it, and runs of both files narrowed by a test name pattern,
   * each after clearing the files of the run before. Of each run, the order
   * vitest ran the two files in, as the sequencer it resolved gave that order
   * inside the run, and whether vitest's cache had `long` failed after it:
   * `short`, whose test takes 50 ms, and `long`, whose tests take 200, none
   * and none, the second failing.
   */
  type Run = { order: string[]; failed: boolean };
  async function asStrykerRuns(patterns: readonly string[]): Promise<Run[]> {
    const pause = (ms: number) => `await new Promise((end) => setTimeout(end, ${ms}));`;
    const root = await makeTempRepo({
      'tests/short.test.ts': `test('short holds', async () => { ${pause(50)} });`,
      'tests/long.test.ts': `test('long holds', async () => { ${pause(200)} }); test('long breaks', () => { throw new Error('broken'); }); test('long quick', () => {});`,
    });
    try {
      const script = `
        import { createVitest } from 'vitest/node';
        const ctx = await createVitest('test', {
          root: ${JSON.stringify(root)},
          config: ${JSON.stringify(join(ROOT, 'vitest.mutation.config.ts'))},
          globals: true, watch: false, pool: 'forks', maxWorkers: 1, maxConcurrency: 1, bail: 1, coverage: { enabled: false },
        });
        const name = (file) => file.moduleId.slice(file.moduleId.lastIndexOf('/') + 1, -'.test.ts'.length);
        const orders = [];
        const { sort } = ctx.config.sequence.sequencer.prototype;
        ctx.config.sequence.sequencer.prototype.sort = async function (files) {
          const sorted = await sort.call(this, files);
          orders.push(sorted.map(name));
          return sorted;
        };
        const files = ['short', 'long'].map((file) => ctx.config.root + '/tests/' + file + '.test.ts');
        const long = ctx.getRootProject().createSpecification(files[1]);
        const results = [];
        for (const pattern of ${JSON.stringify(patterns)}) {
          ctx.state.filesMap.clear();
          for (const project of ctx.projects) project.config.testNamePattern = new RegExp(pattern);
          await ctx.start(files);
          results.push({ order: orders.at(-1), failed: ctx.cache.getTestSpecificationResult(long).failed });
        }
        await ctx.close();
        process.exitCode = 0;
        process.stdout.write('@runs@' + JSON.stringify(results));
      `;
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return JSON.parse(out.slice(out.lastIndexOf('@runs@') + '@runs@'.length)) as Run[];
    } finally {
      await removeTempRepo(root);
    }
  }

  it("runs first, inside the next run, the file that failed in the run before, then the quicker whole file, in runs narrowed as Stryker narrows them, where vitest 5's cache keeps an older failure", async () => {
    const runs = await asStrykerRuns(['holds$', 'short holds$|long breaks$', 'holds$', 'short holds$|long quick$', 'holds$']);
    // The smaller first, as neither has a time; then the quicker; then the
    // one that failed in the run before; then, as it passed there, the
    // quicker again; and after a run of its one quick test, still `short`, by
    // the cache's time, the whole file's: a record of each run's time, which
    // would run `long` first there, swept no better in spec-core (its
    // ADR-0007, 2026-11-09). A record emptied at the start of each run, as an
    // `onInit` of the reporter would empty it, runs the quicker first in the
    // third.
    expect(runs.map(({ order }) => order)).toEqual([
      ['short', 'long'],
      ['short', 'long'],
      ['long', 'short'],
      ['short', 'long'],
      ['short', 'long'],
    ]);
    // Why the order keeps a record: from the second run on vitest's cache has
    // `long` failed, and by it the fourth run would run `long` first. Where it
    // does not, vitest forgets a failure as 4 did, and spec-core's ADR-0008
    // says what a sweep must show before the record goes.
    expect(runs.map(({ failed }) => failed)).toEqual([false, true, true, true, true]);
  });
});

describe('this repository', () => {
  it('gives the order to the sweep, both tiers of it, and leaves `npm test` with vitest\'s own', async () => {
    // One Stryker configuration serves the full sweep and a pull request's
    // incremental one; each shard spreads it (stryker.shard.config.mjs).
    const stryker = ((await import(pathToFileURL(resolve('stryker.config.mjs')).href)) as { default: { vitest: unknown } }).default;
    expect(stryker.vitest).toEqual({ configFile: 'vitest.mutation.config.ts', related: false });
    expect(mutationSuite.test?.sequence).toEqual({ sequencer: QuickestFirst });

    // `npm test` reports every failure and runs its files side by side: the
    // long files started early is the right order there.
    expect(unitSuite.test?.sequence).toBeUndefined();
  });

  it("names the sweep's reporters, vitest's default and the order's record, and leaves `npm test` with those vitest gives it", () => {
    expect(mutationSuite.test?.reporters).toEqual(['default', lastRun]);
    expect(unitSuite.test?.reporters).toBeUndefined();
  });

  it("has the sweep report through vitest's default reporter and the order's record alone on a runner, so that no mutant's run adds a summary or an annotation", () => {
    // Where a suite names none, vitest adds its github-actions reporter on a
    // runner: it appended a summary of every run to the step's own, some
    // 2,570 of them in the largest shard of main's sweep of 3b65529, and its
    // `::error` commands in a crashed worker's output became two annotations
    // on shard 3 of that sweep, which passed (vitest.mutation.config.ts).
    // The record is the reporter given inline, as the test above has it.
    expect(onARunner('vitest.mutation.config.ts')).toEqual(['default', 'inline']);
    // The suite `npm test` runs keeps the annotations and the summary vitest
    // gives a run on a runner.
    expect(onARunner('vitest.config.ts')).toContain('github-actions');
  });

  it('adds no test to a mutation run and takes none out of it but the four that can kill nothing', () => {
    expect(mutationSuite.test?.include).toEqual(unitSuite.test?.include);
    expect(mutationSuite.test?.exclude).toEqual([
      'tests/e2e.test.ts',
      'tests/replay-scripts.test.ts',
      'tests/mutation-order.test.ts',
      'tests/mutation-unmeasured.test.ts',
      ...unitSuite.test!.exclude!,
    ]);
  });
});
