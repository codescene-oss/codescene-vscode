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
      assert.strictEqual(cliConfig.artifacts[testCase.platform][testCase.arch], testCase.expected);
      assert.ok(!testCase.expected.includes('jre'));
    }
  });

  test('uses the platform native binary file name', () => {
    assert.strictEqual(cliConfig.nativeBinaryFileName('win32'), 'cs-ide.exe');
    assert.strictEqual(cliConfig.nativeBinaryFileName('linux'), 'cs-ide');
    assert.strictEqual(cliConfig.nativeBinaryFileName('darwin'), 'cs-ide');
  });

  test('requires the signed JNA library to travel with the macOS binary', () => {
    assert.deepStrictEqual(cliConfig.requiredSidecarFileNames('darwin'), ['libjnidispatch.jnilib']);
    assert.deepStrictEqual(cliConfig.requiredSidecarFileNames('linux'), []);
    assert.deepStrictEqual(cliConfig.requiredSidecarFileNames('win32'), []);
  });
});

suite('Native CLI Bundle Script Test Suite', () => {
  const directories: string[] = [];

  teardown(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('finds the native binary at the extract root or one nested directory', () => {
    const { locateNativeBinary } = require('../../../scripts/bundle-cli');
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
    const { locateNativeBinary } = require('../../../scripts/bundle-cli');
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-native-empty-'));
    directories.push(empty);
    assert.throws(() => locateNativeBinary(empty, 'win32'), /Expected native cs-ide.exe/);
  });

  test('finds the signed JNA library beside the macOS binary', () => {
    const { locateRequiredSidecars } = require('../../../scripts/bundle-cli');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-native-sidecar-'));
    directories.push(root);

    const binary = path.join(root, 'cs-ide');
    const sidecar = path.join(root, 'libjnidispatch.jnilib');
    fs.writeFileSync(binary, '');
    fs.writeFileSync(sidecar, '');

    assert.deepStrictEqual(locateRequiredSidecars(binary, 'darwin'), [sidecar]);
    assert.deepStrictEqual(locateRequiredSidecars(binary, 'linux'), []);
  });

  test('fails when the macOS distribution omits the signed JNA library', () => {
    const { locateRequiredSidecars } = require('../../../scripts/bundle-cli');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-native-no-sidecar-'));
    directories.push(root);

    const binary = path.join(root, 'cs-ide');
    fs.writeFileSync(binary, '');

    assert.throws(() => locateRequiredSidecars(binary, 'darwin'), /libjnidispatch.jnilib/);
  });
});
