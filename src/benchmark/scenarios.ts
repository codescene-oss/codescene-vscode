import { BenchmarkAdapter, delay, GIT_OBSERVE_QUIESCENCE, WATCH_DRAIN_MS, WATCH_QUIESCENCE } from './adapter';
import { FixtureFile, FixtureRepo } from './fixture-repo';

const WATCH_FILE_COUNT = 20;
const BIG_FILE_METHOD_COUNT = 40;
const ITERATIONS = 3;

/**
 * Both architectures cache reviews by content, and scenarios draw from the same head of the file
 * list. Every scenario therefore needs its own salt range, otherwise a later scenario silently
 * measures a cache hit instead of real work.
 */
const STASH_SALT_BASE = 100;
const CHECKOUT_SALT_BASE = 200;
const REVIEW_SALT_BASES: Record<number, number> = { 10: 300, 100: 400, 200: 500 };
const BIG_FILE_SALT_BASE = 600;
const WATCH_SALT_BASE = 700;

export interface ScenarioContext {
  repo: FixtureRepo;
  adapter: BenchmarkAdapter;
}

export interface ScenarioResult {
  fileCount: number;
  latencies: number[];
}

export interface Scenario {
  id: string;
  description: string;
  iterations: number;
  setup(context: ScenarioContext, iteration: number): Promise<void>;
  run(context: ScenarioContext): Promise<ScenarioResult>;
  teardown(context: ScenarioContext): Promise<void>;
}

function noTeardown(): Promise<void> {
  return Promise.resolve();
}

async function stopWatching(context: ScenarioContext): Promise<void> {
  await context.adapter.unwatch(context.repo.root);
  await delay(WATCH_DRAIN_MS);
}

function bufferScenario(
  id: string,
  description: string,
  build: (repo: FixtureRepo, salt: number) => FixtureFile[]
): Scenario {
  let files: FixtureFile[] = [];
  return {
    id,
    description,
    iterations: ITERATIONS,
    setup: (context, iteration) => {
      context.repo.reset();
      files = build(context.repo, iteration);
      return Promise.resolve();
    },
    run: async (context) => {
      context.adapter.beginMeasurement();
      await context.adapter.enqueue(context.repo.root, files);
      await context.adapter.waitForQuiescence();
      return { fileCount: files.length, latencies: context.adapter.latencies() };
    },
    teardown: noTeardown,
  };
}

export function reviewFilesScenario(count: number): Scenario {
  const saltBase = REVIEW_SALT_BASES[count] ?? count;
  return bufferScenario(
    `review-${count}-files`,
    `Review ${count} modified files submitted as dirty buffers`,
    (repo, salt) => repo.changedFiles(count, saltBase + salt)
  );
}

export function bigSmellyFileScenario(): Scenario {
  return bufferScenario(
    'big-smelly-file',
    `Review the largest source file with ${BIG_FILE_METHOD_COUNT} injected code smells`,
    (repo, salt) => [repo.bigSmellyFile(BIG_FILE_METHOD_COUNT, BIG_FILE_SALT_BASE + salt)]
  );
}

export function largeRepoWatchScenario(): Scenario {
  return {
    id: 'large-repo-watch-20-files',
    description: `Cold watch start on a large repository with a ${WATCH_FILE_COUNT} file change set`,
    iterations: ITERATIONS,
    setup: async (context, iteration) => {
      context.repo.reset();
      context.repo.writeFiles(context.repo.changedFiles(WATCH_FILE_COUNT, WATCH_SALT_BASE + iteration));
      context.repo.commitAll('benchmark change set');
      await context.adapter.restart();
    },
    run: async (context) => {
      context.adapter.beginMeasurement();
      await context.adapter.watch(context.repo.root);
      await context.adapter.waitForQuiescence(WATCH_QUIESCENCE);
      return { fileCount: WATCH_FILE_COUNT, latencies: context.adapter.latencies() };
    },
    teardown: stopWatching,
  };
}

export function gitStashPopScenario(): Scenario {
  return {
    id: 'git-stash-pop',
    description: `Stash and pop a ${WATCH_FILE_COUNT} file working tree change set while watching`,
    iterations: ITERATIONS,
    setup: async (context, iteration) => {
      context.repo.reset();
      context.repo.writeFiles(context.repo.changedFiles(WATCH_FILE_COUNT, STASH_SALT_BASE + iteration));
      await context.adapter.watch(context.repo.root);
      context.adapter.beginMeasurement();
      await context.adapter.waitForQuiescence(GIT_OBSERVE_QUIESCENCE);
    },
    run: async (context) => {
      context.adapter.beginMeasurement();
      const pushed = context.repo.git('stash', 'push', '--include-untracked');
      if (context.repo.git('stash', 'list').trim().length === 0) {
        throw new Error(`git stash push created no stash entry: ${pushed.trim()}`);
      }
      // Restoring through the stash commit rather than "stash pop", because the stash ref does not
      // reliably survive a concurrently running CLI.
      const stashCommit = context.repo.git('rev-parse', 'stash@{0}').trim();
      await context.adapter.waitForQuiescence(GIT_OBSERVE_QUIESCENCE);
      context.repo.git('checkout', stashCommit, '--', '.');
      await context.adapter.waitForQuiescence(GIT_OBSERVE_QUIESCENCE);
      return { fileCount: WATCH_FILE_COUNT, latencies: context.adapter.latencies() };
    },
    teardown: stopWatching,
  };
}

export function gitCheckoutBranchScenario(): Scenario {
  return {
    id: 'git-checkout-branch',
    description: `Check out the baseline branch and back while watching a ${WATCH_FILE_COUNT} file change set`,
    iterations: ITERATIONS,
    setup: async (context, iteration) => {
      context.repo.reset();
      context.repo.writeFiles(context.repo.changedFiles(WATCH_FILE_COUNT, CHECKOUT_SALT_BASE + iteration));
      context.repo.commitAll('benchmark change set');
      await context.adapter.watch(context.repo.root);
      context.adapter.beginMeasurement();
      await context.adapter.waitForQuiescence(GIT_OBSERVE_QUIESCENCE);
    },
    run: async (context) => {
      context.adapter.beginMeasurement();
      context.repo.git('checkout', '-f', context.repo.baselineBranch);
      await context.adapter.waitForQuiescence(GIT_OBSERVE_QUIESCENCE);
      context.repo.git('checkout', '-f', context.repo.workBranch);
      await context.adapter.waitForQuiescence(GIT_OBSERVE_QUIESCENCE);
      return { fileCount: WATCH_FILE_COUNT, latencies: context.adapter.latencies() };
    },
    teardown: stopWatching,
  };
}

export function benchmarkScenarios(): Scenario[] {
  return [
    reviewFilesScenario(10),
    reviewFilesScenario(100),
    reviewFilesScenario(200),
    bigSmellyFileScenario(),
    largeRepoWatchScenario(),
    gitStashPopScenario(),
    gitCheckoutBranchScenario(),
  ];
}
