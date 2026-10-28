import * as os from 'os';
import { IdeServerAdapter } from '../adapters/ide-server-adapter';
import { FixtureRepo } from '../fixture-repo';
import { ProcessMetrics } from '../process-metrics';
import { benchmarkLabel, ScenarioReport, writeReport } from '../report';
import { environmentInfo, outputDir, runScenario } from '../runner';
import { selectedBenchmarkScenarios } from '../scenarios';

if (process.env.CS_BENCH_ISOLATED === '1') {
  try {
    os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL);
    console.log(`isolated benchmark process ${process.pid} priority above normal`);
  } catch (error) {
    console.error(`could not raise benchmark priority: ${error instanceof Error ? error.message : String(error)}`);
  }
}

suite('Review Pipeline Benchmarks', () => {
  const label = benchmarkLabel(process.env);
  const repo = new FixtureRepo();
  const metrics = new ProcessMetrics();
  const adapter = new IdeServerAdapter();
  const reports: ScenarioReport[] = [];

  suiteSetup(async () => {
    repo.prepare();
    metrics.install();
    await adapter.start();
  });

  suiteTeardown(async () => {
    await adapter.stop();
    metrics.dispose();
    writeReport(
      {
        adapter: adapter.name,
        label,
        server: adapter.serverMetadata(),
        createdAt: new Date().toISOString(),
        environment: environmentInfo(),
        scenarios: reports,
      },
      outputDir()
    );
  });

  selectedBenchmarkScenarios().forEach((scenario) => {
    test(scenario.id, async () => {
      reports.push(await runScenario(scenario, { repo, adapter }, metrics));
    });
  });
});
