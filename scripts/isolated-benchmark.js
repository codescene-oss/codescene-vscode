const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { aggregateReports, pidsForExecutable, wallMatrix } = require('./benchmark-aggregate');
const { compareReports, comparisonFailed } = require('./compare-benchmarks');

const repoRoot = path.join(__dirname, '..');
const mochaBin = path.join(repoRoot, 'node_modules', 'mocha', 'bin', 'mocha.js');
const outputRoot = path.join(repoRoot, 'bench-results', 'isolated');
const cooldownMs = Number(process.env.CS_BENCH_COOLDOWN_MS || 5000);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name}`);
    process.exit(1);
  }
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listCsIdeProcesses() {
  if (process.platform !== 'win32') return [];
  const command = [
    "Get-CimInstance Win32_Process -Filter \"Name = 'cs-ide.exe'\" |",
    "ForEach-Object { '{0}|{1}' -f $_.ProcessId, $_.ExecutablePath }",
  ].join(' ');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
  return output
    .split(/\r?\n/)
    .map((line) => {
      const separator = line.indexOf('|');
      if (separator < 1) return undefined;
      return { pid: Number(line.slice(0, separator)), executablePath: line.slice(separator + 1) };
    })
    .filter((processInfo) => processInfo && processInfo.executablePath);
}

function stopLeakedServers(executable) {
  let processes = [];
  try {
    processes = listCsIdeProcesses();
  } catch (error) {
    console.error(`could not list cs-ide processes: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  pidsForExecutable(processes, executable).forEach((pid) => {
    console.error(`stopping leaked cs-ide ${pid} (${executable})`);
    execFileSync('taskkill', ['/PID', String(pid), '/F', '/T']);
  });
}

function runBench(executable, label, outputDir) {
  const env = { ...process.env };
  delete env.CS_BENCH_ITERATIONS;
  delete env.CS_BENCH_SCENARIOS;
  env.CS_BENCH_BIN = executable;
  env.CS_BENCH_LABEL = label;
  env.CS_BENCH_ANALYSIS_ONLY = '1';
  env.CS_BENCH_OUTPUT = outputDir;
  env.CS_BENCH_ISOLATED = '1';
  env.CS_DISABLE_TRACKING = '1';
  env.CS_DISABLE_VERSION_CHECK = '1';
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mochaBin, '--config', '.mocharc.bench.json'], {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} benchmark exited with code ${code}`));
    });
  });
}

function loadReport(outputDir, label) {
  return JSON.parse(fs.readFileSync(path.join(outputDir, `${label}.json`), 'utf8'));
}

async function main() {
  const rounds = Number(process.env.CS_BENCH_ROUNDS || 3);
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error(`CS_BENCH_ROUNDS must be a positive integer, got ${process.env.CS_BENCH_ROUNDS}`);
  const beforeBin = requiredEnv('CS_BENCH_BEFORE_BIN');
  const afterBin = requiredEnv('CS_BENCH_AFTER_BIN');
  const beforeLabel = process.env.CS_BENCH_BEFORE_LABEL || 'master';
  const afterLabel = process.env.CS_BENCH_AFTER_LABEL || 'perf-cli-review';
  [beforeBin, afterBin].forEach((executable) => {
    if (!fs.existsSync(executable)) throw new Error(`benchmark binary not found at ${executable}`);
  });
  if (!fs.existsSync(mochaBin)) throw new Error('mocha is not installed. Run make pretest first.');

  const beforeReports = [];
  const afterReports = [];
  for (let round = 1; round <= rounds; round++) {
    const outputDir = path.join(outputRoot, `round-${round}`);
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`\n=== isolated round ${round}/${rounds}: ${beforeLabel} ===`);
    await runBench(beforeBin, beforeLabel, outputDir);
    stopLeakedServers(beforeBin);
    await delay(cooldownMs);
    console.log(`\n=== isolated round ${round}/${rounds}: ${afterLabel} ===`);
    await runBench(afterBin, afterLabel, outputDir);
    stopLeakedServers(afterBin);
    if (round < rounds) await delay(cooldownMs);
    beforeReports.push(loadReport(outputDir, beforeLabel));
    afterReports.push(loadReport(outputDir, afterLabel));
  }

  const beforeAggregate = aggregateReports(beforeReports);
  const afterAggregate = aggregateReports(afterReports);
  fs.writeFileSync(path.join(outputRoot, `${beforeLabel}.json`), `${JSON.stringify(beforeAggregate, null, 2)}\n`);
  fs.writeFileSync(path.join(outputRoot, `${afterLabel}.json`), `${JSON.stringify(afterAggregate, null, 2)}\n`);
  console.log(`\nIsolated rounds: ${rounds}. Each round is a fresh Node process and a fresh cs-ide server.`);
  console.log('Wall time is the per-round median, in ms.\n');
  console.log(wallMatrix(beforeLabel, beforeReports, afterLabel, afterReports));
  console.log('\nAggregated median of those rounds:\n');
  console.log(compareReports(beforeAggregate, afterAggregate));
  if (comparisonFailed(beforeAggregate, afterAggregate)) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
