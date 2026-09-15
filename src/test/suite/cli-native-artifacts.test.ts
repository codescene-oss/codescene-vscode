import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const cliConfig = require('../../../scripts/cli-config');

suite('CLI Native Artifacts Test Suite', () => {
  test('maps platform and arch to native zip names at the pinned SHA', () => {
    const sha = cliConfig.requiredDevtoolsVersion;
    const cases = [
      { platform: 'win32', arch: 'x64', expected: `cs-ide-windows-amd64-${sha}.zip` },
      { platform: 'linux', arch: 'x64', expected: `cs-ide-linux-amd64-${sha}.zip` },
      { platform: 'linux', arch: 'arm64', expected: `cs-ide-linux-aarch64-${sha}.zip` },
      { platform: 'darwin', arch: 'x64', expected: `cs-ide-macos-amd64-${sha}.zip` },
      { platform: 'darwin', arch: 'arm64', expected: `cs-ide-macos-aarch64-${sha}.zip` },
    ];

    for (const testCase of cases) {
      assert.strictEqual(cliConfig.nativeArtifactName(testCase.platform, testCase.arch), testCase.expected);
    }
  });

  test('rejects unsupported platform and arch combinations', () => {
    assert.throws(() => cliConfig.nativeArtifactName('win32', 'arm64'), /Unsupported platform\/arch/);
    assert.throws(() => cliConfig.nativeArtifactName('sunos', 'x64'), /Unsupported platform\/arch/);
  });

  test('keeps native extracts out of the JRE distribution directory', () => {
    const cases = [
      { platform: 'win32', arch: 'x64', expected: 'cs-native-win32-x64' },
      { platform: 'linux', arch: 'x64', expected: 'cs-native-linux-x64' },
      { platform: 'darwin', arch: 'arm64', expected: 'cs-native-darwin-arm64' },
    ];

    for (const testCase of cases) {
      assert.strictEqual(cliConfig.nativeDistributionName(testCase.platform, testCase.arch), testCase.expected);
      assert.notStrictEqual(testCase.expected, `cs-${testCase.platform}-${testCase.arch}`);
    }
  });

  test('uses the platform native binary file name', () => {
    assert.strictEqual(cliConfig.nativeBinaryFileName('win32'), 'cs-ide.exe');
    assert.strictEqual(cliConfig.nativeBinaryFileName('linux'), 'cs-ide');
    assert.strictEqual(cliConfig.nativeBinaryFileName('darwin'), 'cs-ide');
  });
});

suite('Native CLI Bundle Script Test Suite', () => {
  const directories: string[] = [];

  function bundleNativeCli() {
    return require('../../../scripts/bundle-native-cli');
  }

  teardown(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('finds the native binary at the extract root or one nested directory', () => {
    const { locateNativeBinary } = bundleNativeCli();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-native-root-'));
    const nested = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-native-nested-'));
    directories.push(root, nested);

    const rootBinary = path.join(root, 'cs-ide.exe');
    fs.writeFileSync(rootBinary, '');
    assert.strictEqual(locateNativeBinary(root, 'win32'), rootBinary);

    const nestedDir = path.join(nested, 'cs-ide-windows-amd64');
    fs.mkdirSync(nestedDir);
    const nestedBinary = path.join(nestedDir, 'cs-ide');
    fs.writeFileSync(nestedBinary, '');
    assert.strictEqual(locateNativeBinary(nested, 'linux'), nestedBinary);
  });

  test('fails when the native binary is missing after extraction', () => {
    const { locateNativeBinary } = bundleNativeCli();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-native-empty-'));
    directories.push(empty);
    assert.throws(() => locateNativeBinary(empty, 'win32'), /cs-ide.exe/);
  });
});
