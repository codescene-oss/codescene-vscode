import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { jarServerCommand } from '../../devtools-api/ide-server-client';
import { jarBenchmarkCommand, productionServerArgs } from '../../benchmark/adapters/ide-server-adapter';

suite('JAR Server Command Test Suite', () => {
  const directories: string[] = [];

  function makeDistribution(withCache: boolean): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-ide-aot-'));
    directories.push(directory);
    fs.mkdirSync(path.join(directory, 'jre', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'cs-ide.jar'), '');
    if (withCache) fs.writeFileSync(path.join(directory, 'cs-ide.aot'), '');
    return directory;
  }

  teardown(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('omits AOT cache flags when cs-ide.aot is missing', () => {
    const distribution = makeDistribution(false);
    const java = path.join(distribution, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const jar = path.join(distribution, 'cs-ide.jar');
    assert.deepStrictEqual(jarServerCommand(distribution, ['server', '--threads', '8']), {
      path: java,
      args: ['--enable-native-access=ALL-UNNAMED', '-jar', jar, 'server', '--threads', '8'],
    });
  });

  test('passes AOTCache before -jar when cs-ide.aot exists and never forces AOTMode=on', () => {
    const distribution = makeDistribution(true);
    const java = path.join(distribution, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const jar = path.join(distribution, 'cs-ide.jar');
    const cache = path.join(distribution, 'cs-ide.aot');
    const command = jarServerCommand(distribution, ['server', '--threads', '8']);
    assert.deepStrictEqual(command, {
      path: java,
      args: [
        '--enable-native-access=ALL-UNNAMED',
        `-XX:AOTCache=${cache}`,
        '-jar',
        jar,
        'server',
        '--threads',
        '8',
      ],
    });
    assert.ok(!command.args.some((arg) => arg.includes('AOTMode=on')));
  });

  test('keeps benchmark heap flags in front of the AOT cache flag', () => {
    const distribution = makeDistribution(true);
    const command = jarBenchmarkCommand(distribution);
    const jarIndex = command.args.indexOf('-jar');
    const cacheFlag = `-XX:AOTCache=${path.join(distribution, 'cs-ide.aot')}`;
    assert.ok(command.args.slice(0, jarIndex).includes('-Xmx512m'));
    assert.ok(command.args.slice(0, jarIndex).includes(cacheFlag));
    assert.ok(command.args.indexOf('-Xmx512m') < command.args.indexOf(cacheFlag));
    assert.deepStrictEqual(command.args.slice(jarIndex), [
      '-jar',
      path.join(distribution, 'cs-ide.jar'),
      ...productionServerArgs(),
    ]);
  });
});
