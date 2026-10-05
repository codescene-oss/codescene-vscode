import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  canonicalRepoRoot,
  normalizeFsPath,
  pathsEqual,
  relativePosix,
  rememberLocalRepoRoot,
  toLocalRepoRoot,
  toPosixRelPath,
} from '../../utils/fs-paths';

suite('fs-paths Test Suite', () => {
  test('toPosixRelPath normalizes separators', () => {
    assert.strictEqual(toPosixRelPath('CSharp\\Example.cs'), 'CSharp/Example.cs');
    assert.strictEqual(toPosixRelPath('CSharp/Example.cs'), 'CSharp/Example.cs');
  });

  test('pathsEqual ignores drive letter case on Windows', function () {
    if (process.platform !== 'win32') this.skip();
    assert.strictEqual(pathsEqual('c:\\Git\\codescene', 'C:\\Git\\codescene'), true);
    assert.strictEqual(normalizeFsPath('C:\\Git\\Foo'), normalizeFsPath('c:\\git\\foo'));
  });

  test('pathsEqual treats Windows-style roots as equal across separators and drive case', () => {
    assert.strictEqual(pathsEqual('c:\\Git\\codescene', 'C:\\Git\\codescene'), true);
    assert.strictEqual(pathsEqual('c:\\Git\\codescene', 'C:/Git/codescene'), true);
  });

  test('pathsEqual treats a symlinked repo root as its real path', () => {
    // macOS hands out /var/... temp paths while the CLI reports the realpath /private/var/...
    const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-real-root-'));
    const linkedRoot = `${realRoot}-link`;
    fs.symlinkSync(realRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      assert.strictEqual(pathsEqual(linkedRoot, realRoot), true);
      assert.strictEqual(canonicalRepoRoot(linkedRoot), canonicalRepoRoot(realRoot));
      rememberLocalRepoRoot(linkedRoot);
      assert.strictEqual(toLocalRepoRoot(realRoot), linkedRoot);
    } finally {
      fs.rmSync(linkedRoot, { recursive: true, force: true });
      fs.rmSync(realRoot, { recursive: true, force: true });
    }
  });

  test('canonicalRepoRoot falls back to the normalized path when the root does not exist', () => {
    const missing = path.join(os.tmpdir(), 'cs-missing-root-does-not-exist');
    assert.strictEqual(canonicalRepoRoot(missing), normalizeFsPath(missing));
    assert.strictEqual(toLocalRepoRoot(missing), missing);
  });

  test('relativePosix returns forward-slash relative paths', function () {
    if (process.platform !== 'win32') {
      assert.strictEqual(relativePosix('/repo', '/repo/src/file.ts'), 'src/file.ts');
      return;
    }
    assert.strictEqual(relativePosix('c:\\repo', 'c:\\repo\\src\\file.ts'), 'src/file.ts');
  });
});
