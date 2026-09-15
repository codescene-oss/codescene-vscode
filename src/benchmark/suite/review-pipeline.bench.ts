import { IdeServerAdapter } from '../adapters/ide-server-adapter';
import { FixtureRepo } from '../fixture-repo';
import { ProcessMetrics } from '../process-metrics';
import { ScenarioReport, writeReport } from '../report';
import { environmentInfo, outputDir, runScenario } from '../runner';
import { benchmarkScenarios } from '../scenarios';

suite('Review Pipeline Benchmarks', () => {
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
      { adapter: adapter.name, createdAt: new Date().toISOString(), environment: environmentInfo(), scenarios: reports },
      outputDir()
    );
  });

  benchmarkScenarios().forEach((scenario) => {
    test(scenario.id, async () => {
      reports.push(await runScenario(scenario, { repo, adapter }, metrics));
    });
  });
});
