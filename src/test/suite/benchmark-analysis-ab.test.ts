import * as assert from 'assert';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveBenchBinary } from '../../benchmark/bench-binary';
import {
  assertPinnedEncodingHelper,
  encodingHelperDir,
  jellyfinFixtureFile,
  measuredEncodingHelper,
  pinnedEncodingHelperBytes,
  pinnedEncodingHelperLines,
  pinnedEncodingHelperSha256,
  readPinnedEncodingHelper,
} from '../../benchmark/encoding-helper';
import { BenchmarkReport, benchmarkLabel, writeReport } from '../../benchmark/report';
import {
  compatibilityFailures,
  expectedJellyfinIssueCategories,
  expectedJellyfinScore,
  fingerprintOf,
  ReviewFingerprint,
} from '../../benchmark/review-fingerprint';
import { runScenario } from '../../benchmark/runner';
import { benchmarkScenarios, Scenario, selectedBenchmarkScenarios } from '../../benchmark/scenarios';
import { Review } from '../../devtools-api/review-model';

const nodeRequire = createRequire(__filename);
const { compareReports, comparisonFailed } = nodeRequire('../../../scripts/compare-benchmarks.js') as {
  compareReports: (before: BenchmarkReport, after: BenchmarkReport) => string;
  comparisonFailed: (before: BenchmarkReport, after: BenchmarkReport) => boolean;
};
const { aggregateReports, pidsForExecutable } = nodeRequire('../../../scripts/benchmark-aggregate.js') as {
  aggregateReports: (reports: BenchmarkReport[]) => BenchmarkReport & { rounds: number };
  pidsForExecutable: (processes: Array<{ pid: number; executablePath: string }>, executable: string) => number[];
};

const pinnedCategories = [...expectedJellyfinIssueCategories];

function reviewWith(categories: string[]): Review {
  return {
    score: expectedJellyfinScore,
    'raw-score': 'raw',
    'file-level-code-smells': categories.slice(0, 1).map((category) => ({
      category,
      details: '',
      'highlight-range': { 'start-line': 1, 'start-column': 1, 'end-line': 1, 'end-column': 1 },
    })),
    'function-level-code-smells': [
      {
        function: 'GetArguments',
        range: { 'start-line': 2, 'start-column': 1, 'end-line': 4, 'end-column': 1 },
        'code-smells': categories.slice(1).map((category) => ({
          category,
          details: '',
          'highlight-range': { 'start-line': 2, 'start-column': 1, 'end-line': 3, 'end-column': 1 },
        })),
      },
      {
        function: 'GetArgumentsAgain',
        range: { 'start-line': 5, 'start-column': 1, 'end-line': 6, 'end-column': 1 },
        'code-smells': categories.slice(1, 2).map((category) => ({
          category,
          details: '',
          'highlight-range': { 'start-line': 5, 'start-column': 1, 'end-line': 6, 'end-column': 1 },
        })),
      },
    ],
  };
}

function medianMeasurement(wallMs: number) {
  return {
    wallMs,
    resultCount: 10,
    p95LatencyMs: wallMs,
    cliCpuMs: wallMs,
    extensionCpuMs: 1,
    peakRssMb: 128,
    processCount: 1,
    childWallMs: wallMs,
  };
}

function reportWith(
  label: string,
  sha: string,
  wallMs: number,
  compatibility?: BenchmarkReport['scenarios'][number]['compatibility']
): BenchmarkReport {
  return {
    adapter: 'ide-server',
    label,
    server: { sha, version: '1.0.76-SNAPSHOT' },
    createdAt: '2026-10-22T08:00:00.000Z',
    environment: { platform: 'win32', arch: 'x64', cpus: 8, nodeVersion: 'v22.0.0' },
    scenarios: [
      {
        id: 'review-10-files',
        description: 'Review 10 modified files submitted as dirty buffers',
        fileCount: 10,
        iterations: [medianMeasurement(wallMs)],
        median: medianMeasurement(wallMs),
        ...(compatibility ? { compatibility } : {}),
      },
    ],
  };
}

suite('Analysis A/B benchmark harness', () => {
  const compatibilityCases: Array<{
    name: string;
    actual: ReviewFingerprint | undefined;
    failures: string[];
    failureIncludes?: string;
  }> = [
    {
      name: 'accepts the pinned Jellyfin score and categories in any order',
      actual: { score: expectedJellyfinScore, issueCategories: [...pinnedCategories].reverse() },
      failures: [],
    },
    {
      name: 'accepts a score within a billionth of the pinned value',
      actual: { score: expectedJellyfinScore + 1e-12, issueCategories: pinnedCategories },
      failures: [],
    },
    {
      name: 'reports a score mismatch',
      actual: { score: 9, issueCategories: pinnedCategories },
      failures: [],
      failureIncludes: 'score',
    },
    {
      name: 'reports missing and unexpected issue categories',
      actual: { score: expectedJellyfinScore, issueCategories: ['Low Cohesion', 'Made Up Smell'] },
      failures: [],
      failureIncludes: 'missing',
    },
    {
      name: 'reports a missing review',
      actual: undefined,
      failures: [],
      failureIncludes: 'no score',
    },
  ];

  compatibilityCases.forEach(({ name, actual, failures, failureIncludes }) => {
    test(name, () => {
      const result = compatibilityFailures(actual);
      if (failureIncludes) {
        assert.ok(
          result.some((failure) => failure.toLowerCase().includes(failureIncludes)),
          `expected a failure containing ${failureIncludes}, got ${JSON.stringify(result)}`
        );
        return;
      }
      assert.deepStrictEqual(result, failures);
    });
  });

  test('keeps the first occurrence of each issue category from file smells then functions', () => {
    assert.deepStrictEqual(issueCategoriesOfSample(), pinnedCategories);
  });

  test('pins the Jellyfin EncodingHelper bytes used by the CLI performance test', () => {
    assert.strictEqual(pinnedEncodingHelperSha256, 'd2fa5f50afd302ff776ed9d7ac4a8500a7fd740d44a8c7f17cae58ccaa152980');
    assert.strictEqual(pinnedEncodingHelperBytes, 358293);
    assert.strictEqual(pinnedEncodingHelperLines, 8093);
    assert.strictEqual(expectedJellyfinScore, 1.004356454215819);
    assert.deepStrictEqual(pinnedCategories, [
      'Low Cohesion',
      'Brain Method',
      'Bumpy Road Ahead',
      'Deep, Nested Complexity',
      'Overall Code Complexity',
      'Complex Method',
      'Complex Conditional',
      'Large Method',
      'Excess Number of Function Arguments',
      'Constructor Over-Injection',
      'Primitive Obsession',
    ]);
  });

  test('rejects a file that is not the pinned EncodingHelper', () => {
    assert.throws(() => assertPinnedEncodingHelper(Buffer.from('not the file')), /pin mismatch/);
  });

  test('measured Jellyfin runs change the bytes so the server review cache misses', () => {
    const pinned = 'class EncodingHelper {}\n';
    const exact = jellyfinFixtureFile(pinned, 'exact');
    const measured = jellyfinFixtureFile(pinned, 2);
    assert.strictEqual(exact.relPath, 'MediaBrowser.Controller/MediaEncoding/EncodingHelper.cs');
    assert.strictEqual(exact.content, pinned);
    assert.strictEqual(measured.relPath, exact.relPath);
    assert.notStrictEqual(measured.content, pinned);
    assert.ok(measured.content.startsWith(pinned));
    assert.strictEqual(measured.content, measuredEncodingHelper(pinned, 2));
  });

  test('downloads EncodingHelper only when the pinned file is absent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bench-helper-'));
    try {
      let downloads = 0;
      await assert.rejects(
        () =>
          readPinnedEncodingHelper(root, async () => {
            downloads += 1;
            return Buffer.from('short');
          }),
        /pin mismatch/
      );
      assert.strictEqual(downloads, 1);
      assert.strictEqual(fs.existsSync(path.join(root, 'EncodingHelper.cs')), false);

      fs.writeFileSync(path.join(root, 'EncodingHelper.cs'), 'cached');
      downloads = 0;
      const cached = await readPinnedEncodingHelper(
        root,
        async () => {
          downloads += 1;
          return Buffer.from('downloaded');
        },
        () => undefined
      );
      assert.strictEqual(cached, 'cached');
      assert.strictEqual(downloads, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('stores EncodingHelper beside the bench data directory', () => {
    const previous = process.env.CS_BENCH_DATA;
    process.env.CS_BENCH_DATA = path.join('D:', 'bench-data');
    try {
      assert.strictEqual(encodingHelperDir(), path.join('D:', 'bench-data'));
    } finally {
      if (previous === undefined) delete process.env.CS_BENCH_DATA;
      else process.env.CS_BENCH_DATA = previous;
    }
  });

  test('default scenario list stays the September suite', () => {
    const ids = benchmarkScenarios().map((scenario) => scenario.id);
    assert.deepStrictEqual(ids, [
      'review-10-files',
      'review-100-files',
      'review-200-files',
      'big-smelly-file',
      'large-repo-watch-20-files',
      'git-stash-pop',
      'git-checkout-branch',
    ]);
    assert.strictEqual(ids.includes('csharp-jellyfin-encoding-helper'), false);
  });

  test('analysis-only selection keeps Java reviews and the Jellyfin file', () => {
    const scenarios = selectedBenchmarkScenarios({ CS_BENCH_ANALYSIS_ONLY: '1' });
    assert.deepStrictEqual(
      scenarios.map((scenario) => scenario.id),
      [
        'review-10-files',
        'review-100-files',
        'review-200-files',
        'big-smelly-file',
        'csharp-jellyfin-encoding-helper',
      ]
    );
    const jellyfin = scenarios.find((scenario) => scenario.id === 'csharp-jellyfin-encoding-helper');
    assert.strictEqual(jellyfin?.iterations, 5);
  });

  test('CS_BENCH_SCENARIOS selects an explicit ordered list', () => {
    assert.deepStrictEqual(
      selectedBenchmarkScenarios({ CS_BENCH_SCENARIOS: 'big-smelly-file, review-10-files' }).map((scenario) => scenario.id),
      ['big-smelly-file', 'review-10-files']
    );
    assert.throws(() => selectedBenchmarkScenarios({ CS_BENCH_SCENARIOS: 'nope' }), /Unknown benchmark scenario nope/);
  });

  test('CS_BENCH_BIN spawns that executable with server', () => {
    assert.strictEqual(resolveBenchBinary({}, () => true), undefined);
    assert.strictEqual(resolveBenchBinary({ CS_BENCH_BIN: '' }, () => true), undefined);
    assert.deepStrictEqual(resolveBenchBinary({ CS_BENCH_BIN: 'C:\\Git\\cs-ide.exe' }, () => true), {
      binaryPath: 'C:\\Git\\cs-ide.exe',
      args: ['server'],
    });
    assert.throws(
      () => resolveBenchBinary({ CS_BENCH_BIN: 'C:\\missing\\cs-ide.exe' }, () => false),
      /CS_BENCH_BIN not found/
    );
  });

  test('names the full report after CS_BENCH_LABEL and records the server build', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bench-report-'));
    try {
      assert.strictEqual(benchmarkLabel({}), undefined);
      assert.strictEqual(benchmarkLabel({ CS_BENCH_LABEL: 'master' }), 'master');
      assert.throws(() => benchmarkLabel({ CS_BENCH_LABEL: '..\\master' }), /CS_BENCH_LABEL/);

      const report = reportWith('perf-cli-review', '69046314b3', 40);
      writeReport(report, dir);
      const written = JSON.parse(fs.readFileSync(path.join(dir, 'perf-cli-review.json'), 'utf8')) as BenchmarkReport;
      assert.strictEqual(written.label, 'perf-cli-review');
      assert.strictEqual(written.server?.sha, '69046314b3');
      assert.strictEqual(fs.existsSync(path.join(dir, 'ide-server.json')), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('warmup review is recorded once and measured runs keep their own fingerprints', async () => {
    const previous = process.env.CS_BENCH_ITERATIONS;
    delete process.env.CS_BENCH_ITERATIONS;
    let warmups = 0;
    let runs = 0;
    const scenario: Scenario = {
      id: 'csharp-jellyfin-encoding-helper',
      description: 'pinned file',
      iterations: 2,
      warmup: () => {
        warmups += 1;
        return Promise.resolve({
          score: expectedJellyfinScore,
          issueCategories: pinnedCategories,
          failures: [],
        });
      },
      setup: () => Promise.resolve(),
      run: () => {
        runs += 1;
        return Promise.resolve({
          fileCount: 1,
          latencies: [runs * 10],
          review: { score: runs, issueCategories: ['Brain Method'] },
        });
      },
      teardown: () => Promise.resolve(),
    };
    try {
      const report = await runScenario(
        scenario,
        { repo: {} as never, adapter: {} as never },
        {
          start: () => Promise.resolve(),
          stop: () =>
            Promise.resolve({
              wallMs: 1,
              cliCpuMs: 0,
              harnessCpuMs: 0,
              peakRssMb: 1,
              processCount: 1,
              childWallMs: 0,
            }),
        }
      );
      assert.strictEqual(warmups, 1);
      assert.strictEqual(runs, 2);
      assert.strictEqual(report.iterations.length, 2);
      assert.deepStrictEqual(report.compatibility, {
        score: expectedJellyfinScore,
        issueCategories: pinnedCategories,
        failures: [],
      });
      assert.deepStrictEqual(report.reviews, [
        { score: 1, issueCategories: ['Brain Method'] },
        { score: 2, issueCategories: ['Brain Method'] },
      ]);
    } finally {
      if (previous === undefined) delete process.env.CS_BENCH_ITERATIONS;
      else process.env.CS_BENCH_ITERATIONS = previous;
    }
  });

  test('prints Jellyfin compatibility apart from the speed table', () => {
    const before = reportWith('master', '98df3ad7ea71237ae4ce03c201af9d7113934829', 100, {
      score: expectedJellyfinScore,
      issueCategories: pinnedCategories,
      failures: [],
    });
    const after = reportWith('perf-cli-review', '69046314b3ba083845a09499ac9b2ab04040b72e', 50, {
      score: 9,
      issueCategories: ['Low Cohesion'],
      failures: ['score 9 != 1.004356454215819'],
    });
    const text = compareReports(before, after);
    assert.ok(text.includes('| review-10-files | wall time | 100 ms | 50 ms | -50.0% |'));
    assert.ok(text.includes('98df3ad7ea71237ae4ce03c201af9d7113934829'));
    assert.ok(text.includes('69046314b3ba083845a09499ac9b2ab04040b72e'));
    assert.ok(text.includes('Compatibility'));
    assert.ok(text.includes('score 9 != 1.004356454215819'));
    assert.strictEqual(comparisonFailed(before, after), true);
    assert.strictEqual(comparisonFailed(before, before), false);
  });

  test('aggregates isolated rounds by the median of each round median', () => {
    const aggregated = aggregateReports([
      reportWith('master', 'aaaaaaaa', 100),
      reportWith('master', 'aaaaaaaa', 300),
      reportWith('master', 'aaaaaaaa', 200),
    ]);
    assert.strictEqual(aggregated.rounds, 3);
    assert.strictEqual(aggregated.scenarios[0].median.wallMs, 200);
    assert.deepStrictEqual(
      aggregated.scenarios[0].iterations.map((iteration) => iteration.wallMs),
      [100, 300, 200]
    );
  });

  test('keeps a compatibility failure from any isolated round', () => {
    const aggregated = aggregateReports([
      reportWith('master', 'aaaaaaaa', 100, {
        score: expectedJellyfinScore,
        issueCategories: pinnedCategories,
        failures: [],
      }),
      reportWith('master', 'aaaaaaaa', 120, {
        score: 9,
        issueCategories: pinnedCategories,
        failures: ['score 9 != 1.004356454215819'],
      }),
    ]);
    assert.ok(aggregated.scenarios[0].compatibility?.failures.some((failure) => failure.includes('score 9')));
  });

  test('refuses to aggregate rounds from different server builds', () => {
    assert.throws(
      () => aggregateReports([reportWith('master', 'aaaaaaaa', 100), reportWith('master', 'bbbbbbbb', 100)]),
      /server sha differs/
    );
  });

  test('only stops a leaked server whose path is the benchmark binary', () => {
    assert.deepStrictEqual(
      pidsForExecutable(
        [
          { pid: 4, executablePath: 'C:\\Git\\codescene-bench-master\\cli\\target\\cs-ide.exe' },
          { pid: 9, executablePath: 'C:\\Git\\other\\cs-ide.exe' },
        ],
        'c:\\git\\codescene-bench-master\\cli\\target\\cs-ide.exe'
      ),
      [4]
    );
  });
});

function issueCategoriesOfSample(): string[] {
  return fingerprintOf(reviewWith(pinnedCategories)).issueCategories;
}
