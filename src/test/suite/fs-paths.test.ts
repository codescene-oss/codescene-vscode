import * as assert from 'assert';
import { normalizeFsPath, pathsEqual, relativePosix, toPosixRelPath } from '../../utils/fs-paths';

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

  test('relativePosix returns forward-slash relative paths', function () {
    if (process.platform !== 'win32') {
      assert.strictEqual(relativePosix('/repo', '/repo/src/file.ts'), 'src/file.ts');
      return;
    }
    assert.strictEqual(relativePosix('c:\\repo', 'c:\\repo\\src\\file.ts'), 'src/file.ts');
  });
});
