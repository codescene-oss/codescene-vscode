import * as assert from 'assert';
import * as path from 'path';
import { distributionServerCommand } from '../../devtools-api/ide-server-client';
import { ArtifactInfo } from '../../artifact-info';

const cliConfig = require('../../../scripts/cli-config');

suite('Distribution Server Command Test Suite', () => {
  test('spawns the native binary with server args and never wraps java -jar', () => {
    const distribution = path.join('cs-win32-x64');
    const command = distributionServerCommand(distribution, ['server', '--threads', '8']);
    const exe = path.join(distribution, cliConfig.nativeBinaryFileName(process.platform));
    assert.deepStrictEqual(command, { path: exe, args: ['server', '--threads', '8'] });
    assert.ok(!command.args.includes('-jar'));
    assert.ok(!command.args.some((arg) => arg.includes('AOTCache')));
    assert.ok(!command.path.includes(`${path.sep}jre${path.sep}`));
  });

  test('resolves the bundled executable inside the platform distribution directory', () => {
    const artifact = new ArtifactInfo('/ext');
    assert.strictEqual(artifact.absoluteBinaryPath, path.join('/ext', `cs-${process.platform}-${process.arch}`));
    assert.strictEqual(
      artifact.absoluteExecutablePath,
      path.join(artifact.absoluteBinaryPath, cliConfig.nativeBinaryFileName(process.platform))
    );
  });
});
