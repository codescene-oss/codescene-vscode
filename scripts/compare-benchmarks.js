const fs = require('fs');

const METRICS = [
  ['wallMs', 'wall time', 'ms'],
  ['resultCount', 'results delivered', 'count'],
  ['p95LatencyMs', 'p95 file latency', 'ms'],
  ['cliCpuMs', 'cli cpu time', 'ms'],
  ['extensionCpuMs', 'extension cpu time', 'ms'],
  ['peakRssMb', 'peak memory', 'MB'],
  ['processCount', 'cli processes', 'count'],
  ['childWallMs', 'child process wall time', 'ms'],
];

function load(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function change(before, after) {
  if (before === 0) return after === 0 ? '0%' : 'n/a';
  const percent = ((after - before) / before) * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

function format(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function describeEnvironment(label, report) {
  const env = report.environment;
  return `${label}: ${report.adapter} on ${env.platform}-${env.arch}, ${env.cpus} cpus, node ${env.nodeVersion}, ${report.createdAt}`;
}

function metricRow(scenario, label, beforeValue, afterValue, unit) {
  return `| ${scenario} | ${label} | ${format(beforeValue)} ${unit} | ${format(afterValue)} ${unit} | ${change(
    beforeValue,
    afterValue
  )} |`;
}

function formatComparison(before, after) {
  const lines = [
    describeEnvironment('before', before),
    describeEnvironment('after', after),
    '',
    '| Scenario | Metric | Before | After | Change |',
    '| --- | --- | ---: | ---: | ---: |',
  ];
  if (before.startupMs != null || after.startupMs != null) {
    lines.push(metricRow('startup', 'startup time', before.startupMs ?? 0, after.startupMs ?? 0, 'ms'));
  }
  if (before.sha || after.sha) {
    lines.push(`| startup | sha | ${before.sha ?? ''} | ${after.sha ?? ''} | |`);
  }
  const afterById = new Map(after.scenarios.map((scenario) => [scenario.id, scenario]));
  for (const scenario of before.scenarios) {
    const counterpart = afterById.get(scenario.id);
    if (!counterpart) continue;
    for (const [key, label, unit] of METRICS) {
      lines.push(metricRow(scenario.id, label, scenario.median[key], counterpart.median[key], unit));
    }
  }
  return lines.join('\n');
}

function main() {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    console.error('Usage: node scripts/compare-benchmarks.js <before.json> <after.json>');
    process.exit(1);
  }

  console.log(formatComparison(load(beforePath), load(afterPath)));
}

if (require.main === module) {
  main();
}

module.exports = { formatComparison, load, change, format };
