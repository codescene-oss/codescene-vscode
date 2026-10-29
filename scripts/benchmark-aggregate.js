const path = require('path');

const METRIC_KEYS = [
  'wallMs',
  'resultCount',
  'p95LatencyMs',
  'cliCpuMs',
  'extensionCpuMs',
  'peakRssMb',
  'processCount',
  'childWallMs',
];

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function mergeCompatibility(runs) {
  const checks = runs.map((run) => run.compatibility).filter((check) => check);
  if (checks.length === 0) return undefined;
  const failures = [];
  checks.forEach((check, index) => {
    check.failures.forEach((failure) => failures.push(`round ${index + 1}: ${failure}`));
  });
  const scores = checks.map((check) => check.score);
  if (new Set(scores).size > 1) failures.push(`scores differ across rounds: ${scores.join(', ')}`);
  return {
    score: checks[0].score,
    issueCategories: checks[0].issueCategories,
    failures,
  };
}

function aggregateReports(reports) {
  if (!reports || reports.length === 0) throw new Error('no benchmark rounds to aggregate');
  const sha = reports[0].server && reports[0].server.sha;
  reports.forEach((report, index) => {
    const roundSha = report.server && report.server.sha;
    if (roundSha !== sha) throw new Error(`server sha differs in round ${index + 1}: ${roundSha} != ${sha}`);
  });
  const scenarios = reports[0].scenarios.map((first) => {
    const runs = reports.map((report, index) => {
      const scenario = report.scenarios.find((candidate) => candidate.id === first.id);
      if (!scenario) throw new Error(`missing scenario ${first.id} in round ${index + 1}`);
      return scenario;
    });
    const iterations = runs.map((run) => run.median);
    const aggregatedMedian = {};
    METRIC_KEYS.forEach((key) => {
      aggregatedMedian[key] = median(iterations.map((measurement) => measurement[key]));
    });
    const compatibility = mergeCompatibility(runs);
    return {
      id: first.id,
      description: first.description,
      fileCount: first.fileCount,
      iterations,
      median: aggregatedMedian,
      ...(compatibility ? { compatibility } : {}),
    };
  });
  return {
    ...reports[0],
    createdAt: new Date().toISOString(),
    rounds: reports.length,
    scenarios,
  };
}

function pidsForExecutable(processes, executable) {
  const expected = path.normalize(executable).toLowerCase();
  return processes
    .filter((processInfo) => processInfo.executablePath && path.normalize(processInfo.executablePath).toLowerCase() === expected)
    .map((processInfo) => processInfo.pid);
}

function wallMatrix(beforeLabel, beforeRounds, afterLabel, afterRounds) {
  const header = [
    'Scenario',
    ...beforeRounds.map((_, index) => `${beforeLabel} ${index + 1}`),
    ...afterRounds.map((_, index) => `${afterLabel} ${index + 1}`),
  ];
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map((_, index) => (index === 0 ? '---' : '---:')).join(' | ')} |`,
  ];
  beforeRounds[0].scenarios.forEach((scenario) => {
    const before = beforeRounds.map((report) => report.scenarios.find((candidate) => candidate.id === scenario.id).median.wallMs);
    const after = afterRounds.map((report) => report.scenarios.find((candidate) => candidate.id === scenario.id).median.wallMs);
    lines.push(`| ${scenario.id} | ${[...before, ...after].join(' ms | ')} ms |`);
  });
  return lines.join('\n');
}

module.exports = { aggregateReports, median, pidsForExecutable, wallMatrix };
