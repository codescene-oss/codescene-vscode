import * as assert from 'assert';

const { formatComparison } = require('../../../scripts/compare-benchmarks');

suite('Compare Benchmarks Test Suite', () => {
  const environment = { platform: 'win32', arch: 'x64', cpus: 8, nodeVersion: 'v20.0.0' };
  const scenario = {
    id: 'review-10-files',
    description: 'review 10 files',
    fileCount: 10,
    iterations: [],
    median: {
      wallMs: 1000,
      resultCount: 10,
      p95LatencyMs: 900,
      cliCpuMs: 400,
      extensionCpuMs: 50,
      peakRssMb: 200,
      processCount: 1,
      childWallMs: 800,
    },
  };

  test('prints startup time and SHA before the scenario table', () => {
    const output = formatComparison(
      {
        adapter: 'ide-server',
        createdAt: '2026-01-01T00:00:00.000Z',
        sha: 'abc',
        startupMs: 2000,
        environment,
        scenarios: [scenario],
      },
      {
        adapter: 'native-ide-server',
        createdAt: '2026-01-01T00:01:00.000Z',
        sha: 'abc',
        startupMs: 400,
        environment,
        scenarios: [{ ...scenario, median: { ...scenario.median, wallMs: 1200, peakRssMb: 80 } }],
      }
    );

    assert.match(output, /startup time \| 2000 ms \| 400 ms \| -80\.0%/);
    assert.match(output, /sha \| abc \| abc/);
    assert.match(output, /review-10-files \| wall time \| 1000 ms \| 1200 ms \| \+20\.0%/);
    assert.match(output, /review-10-files \| peak memory \| 200 MB \| 80 MB \| -60\.0%/);
  });
});
