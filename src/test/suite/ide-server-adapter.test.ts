import * as assert from 'assert';
import { cpus } from 'os';
import * as path from 'path';
import { CsIdeServerClient } from '../../devtools-api/ide-server-client';
import {
  benchmarkJvmArgs,
  createBenchmarkAdapter,
  IdeServerAdapter,
  jarBenchmarkCommand,
  nativeExecutablePath,
  productionServerArgs,
} from '../../benchmark/adapters/ide-server-adapter';

suite('IdeServerAdapter Benchmark Test Suite', () => {
  const fixture = path.join(__dirname, '../fixtures/ide-server-fixture.js');
  const originalCli = process.env.CS_BENCH_CLI;
  const originalRequiredVersion = process.env.CS_IDE_REQUIRED_VERSION;
  const originalXmx = process.env.CS_BENCH_JAVA_XMX;
  let adapter: IdeServerAdapter | undefined;

  teardown(async () => {
    if (originalCli === undefined) delete process.env.CS_BENCH_CLI;
    else process.env.CS_BENCH_CLI = originalCli;
    if (originalRequiredVersion === undefined) delete process.env.CS_IDE_REQUIRED_VERSION;
    else process.env.CS_IDE_REQUIRED_VERSION = originalRequiredVersion;
    if (originalXmx === undefined) delete process.env.CS_BENCH_JAVA_XMX;
    else process.env.CS_BENCH_JAVA_XMX = originalXmx;
    await adapter?.stop();
    adapter = undefined;
  });

  test('uses the production worker thread count', () => {
    const threads = Math.max(1, Math.floor(cpus().length / 2));
    assert.deepStrictEqual(productionServerArgs(), ['server', '--threads', String(threads)]);
  });

  test('caps the benchmark JVM heap so RSS cannot hoard host RAM', () => {
    delete process.env.CS_BENCH_JAVA_XMX;
    assert.deepStrictEqual(benchmarkJvmArgs(), [
      '-Xmx512m',
      '-XX:G1PeriodicGCInterval=1000',
      '--enable-native-access=ALL-UNNAMED',
    ]);
    process.env.CS_BENCH_JAVA_XMX = '768m';
    assert.ok(benchmarkJvmArgs().includes('-Xmx768m'));
  });

  test('places heap flags before -jar in the benchmark java command', () => {
    const distribution = path.join('C:', 'dist');
    const command = jarBenchmarkCommand(distribution);
    const jarIndex = command.args.indexOf('-jar');
    assert.ok(command.path.endsWith(process.platform === 'win32' ? 'java.exe' : 'java'));
    assert.ok(jarIndex > 0);
    assert.ok(command.args.slice(0, jarIndex).includes('-Xmx512m'));
    assert.deepStrictEqual(command.args.slice(jarIndex), ['-jar', path.join(distribution, 'cs-ide.jar'), ...productionServerArgs()]);
  });

  test('selects the native adapter name from CS_BENCH_CLI', () => {
    delete process.env.CS_BENCH_CLI;
    assert.strictEqual(createBenchmarkAdapter().name, 'ide-server');
    process.env.CS_BENCH_CLI = 'native';
    assert.strictEqual(createBenchmarkAdapter().name, 'native-ide-server');
  });

  test('points the native executable at cs-native, not the JRE distribution', () => {
    const extensionPath = path.join('C:', 'Git', 'codescene-vscode');
    const resolved = nativeExecutablePath(extensionPath);
    assert.ok(resolved.includes(`cs-native-${process.platform}-${process.arch}`));
    assert.ok(!resolved.includes(`${path.sep}cs-${process.platform}-${process.arch}${path.sep}`));
    assert.ok(resolved.endsWith(process.platform === 'win32' ? 'cs-ide.exe' : 'cs-ide'));
  });

  test('records handshake time and rejects a SHA mismatch', async () => {
    process.env.CS_IDE_REQUIRED_VERSION = 'expected-sha';
    adapter = new IdeServerAdapter('ide-server', async () => new CsIdeServerClient(process.execPath, [fixture]));
    await assert.rejects(() => adapter!.start(), /CLI SHA mismatch: expected expected-sha, got fixture-sha/);
  });

  test('records startupMs after a matching handshake', async () => {
    process.env.CS_IDE_REQUIRED_VERSION = 'fixture-sha';
    adapter = new IdeServerAdapter('ide-server', async () => new CsIdeServerClient(process.execPath, [fixture]));
    await adapter.start();
    assert.ok(adapter.startupMs >= 0);
    assert.ok(adapter.sha === 'fixture-sha');
  });
});
