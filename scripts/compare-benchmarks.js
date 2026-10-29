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
  const name = report.label ? `${report.label} / ${report.adapter}` : report.adapter;
  const server = report.server ? ` cs-ide ${report.server.version} (${report.server.sha})` : '';
  return `${label}: ${name}${server} on ${env.platform}-${env.arch}, ${env.cpus} cpus, node ${env.nodeVersion}, ${report.createdAt}`;
}

function compatibilityLines(report, label) {
  const lines = [];
  for (const scenario of report.scenarios) {
    const check = scenario.compatibility;
    if (check) {
      const status = check.failures.length === 0 ? 'ok' : 'FAIL';
      lines.push(`${label} ${scenario.id}: ${status} score=${check.score} categories=${check.issueCategories.join(', ')}`);
      for (const failure of check.failures) lines.push(`  ${failure}`);
    }
    if (scenario.reviews && scenario.reviews.length > 0) {
      lines.push(`${label} ${scenario.id} measured scores: ${scenario.reviews.map((review) => review.score).join(', ')}`);
    }
  }
  return lines;
}

function compareReports(before, after) {
  const lines = [describeEnvironment('before', before), describeEnvironment('after', after), ''];
  const afterById = new Map(after.scenarios.map((scenario) => [scenario.id, scenario]));
  lines.push('| Scenario | Metric | Before | After | Change |');
  lines.push('| --- | --- | ---: | ---: | ---: |');
  for (const scenario of before.scenarios) {
    const counterpart = afterById.get(scenario.id);
    if (!counterpart) continue;
    for (const [key, label, unit] of METRICS) {
      const beforeValue = scenario.median[key];
      const afterValue = counterpart.median[key];
      lines.push(
        `| ${scenario.id} | ${label} | ${format(beforeValue)} ${unit} | ${format(afterValue)} ${unit} | ${change(
          beforeValue,
          afterValue
        )} |`
      );
    }
  }
  const compatibility = [...compatibilityLines(before, 'before'), ...compatibilityLines(after, 'after')];
  if (compatibility.length > 0) {
    lines.push('');
    lines.push('Compatibility');
    lines.push(...compatibility);
  }
  return lines.join('\n');
}

function comparisonFailed(before, after) {
  return [before, after].some((report) =>
    report.scenarios.some((scenario) => scenario.compatibility && scenario.compatibility.failures.length > 0)
  );
}

function main() {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    console.error('Usage: node scripts/compare-benchmarks.js <before.json> <after.json>');
    process.exit(1);
  }

  const before = load(beforePath);
  const after = load(afterPath);
  console.log(compareReports(before, after));
  if (comparisonFailed(before, after)) process.exit(1);
}

if (require.main === module) main();

module.exports = { compareReports, comparisonFailed };
