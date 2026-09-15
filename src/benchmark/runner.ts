import * as os from 'os';
import * as path from 'path';
import { ProcessMetrics } from './process-metrics';
import { BenchmarkEnvironment, Measurement, measurementOf, medianMeasurement, ScenarioReport } from './report';
import { Scenario, ScenarioContext } from './scenarios';

export function outputDir(): string {
  return process.env.CS_BENCH_OUTPUT ?? path.join(process.cwd(), 'bench-results');
}

function iterationsFor(scenario: Scenario): number {
  const override = Number(process.env.CS_BENCH_ITERATIONS);
  return Number.isInteger(override) && override > 0 ? override : scenario.iterations;
}

export function environmentInfo(): BenchmarkEnvironment {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    nodeVersion: process.version,
  };
}

export async function runScenario(
  scenario: Scenario,
  context: ScenarioContext,
  metrics: ProcessMetrics
): Promise<ScenarioReport> {
  const iterations: Measurement[] = [];
  let fileCount = 0;
  const iterationCount = iterationsFor(scenario);
  for (let iteration = 0; iteration < iterationCount; iteration++) {
    await scenario.setup(context, iteration);
    await metrics.start();
    const result = await scenario.run(context);
    const sample = await metrics.stop();
    await scenario.teardown(context);
    fileCount = result.fileCount;
    iterations.push(measurementOf(sample, result));
  }
  return {
    id: scenario.id,
    description: scenario.description,
    fileCount,
    iterations,
    median: medianMeasurement(iterations),
  };
}
