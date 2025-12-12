import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { GitIgnoreChecker } from '../../git/git-ignore-checker';
import {
  mockWorkspaceFolders,
  createMockWorkspaceFolder,
  restoreDefaultWorkspaceFolders,
} from '../setup';
import { resetGitAvailability } from '../../git/git-detection';

const execAsync = promisify(exec);

suite('GitIgnoreChecker Test Suite', () => {
  let testDir: string;
  let checker: GitIgnoreChecker;

  async function initGitRepo(dir: string) {
    await execAsync('git init', { cwd: dir });
    await execAsync('git config user.email "test@example.com"', { cwd: dir });
    await execAsync('git config user.name "Test User"', { cwd: dir });
    // Create a dummy excludes file to override any possible global gitignore file:
    const dummyExcludesPath = path.join(dir, '.git', 'info', 'exclude-test');
    fs.writeFileSync(dummyExcludesPath, '# Test excludes file - will not match anything\n__xxxxxxxxxxxxx__\n');
    await execAsync(`git config core.excludesfile "${dummyExcludesPath}"`, { cwd: dir });
  }

  setup(() => {
    const testBaseDir = path.join(os.homedir(), '.codescene-test-data');
    if (!fs.existsSync(testBaseDir)) {
      fs.mkdirSync(testBaseDir, { recursive: true });
    }
    testDir = fs.mkdtempSync(path.join(testBaseDir, 'git-ignore-checker-test-'));
  });

  teardown(() => {
    if (checker) {
      checker.dispose();
    }
    const gitignorePath = path.join(testDir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      fs.unlinkSync(gitignorePath);
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    restoreDefaultWorkspaceFolders();
    resetGitAvailability();
  });

  function createNestedDirs(segments: string[]): string {
    let currentPath = testDir;
    for (const segment of segments) {
      currentPath = path.join(currentPath, segment);
      fs.mkdirSync(currentPath);
    }
    return currentPath;
  }

  function createFileAndMockDocument(filePath: string, content: string) {
    fs.writeFileSync(filePath, content);
    return {
      uri: { fsPath: filePath },
      getText: () => content,
    } as any;
  }

  async function assertIsIgnored(filePath: string, content: string, expected: boolean, message: string) {
    const mockDocument = createFileAndMockDocument(filePath, content);
    const result = await (checker as any).isIgnored(mockDocument);
    assert.strictEqual(
      result,
      expected,
      `${message}\n  File: ${filePath}\n  TestDir: ${testDir}\n  Expected: ${expected}, Got: ${result}`
    );
  }

  async function assertMatchesGitCheckIgnore(filePath: string, content: string) {
    const mockDocument = createFileAndMockDocument(filePath, content);
    const result = await (checker as any).isIgnored(mockDocument);

    let gitIgnored = false;
    try {
      const { stdout } = await execAsync(`git check-ignore "${filePath}"`, { cwd: testDir });
      gitIgnored = stdout.trim().length > 0;
    } catch (error: any) {
      gitIgnored = error.code === 0;
    }

    assert.strictEqual(
      result,
      gitIgnored,
      `Result should match git check-ignore\n  File: ${filePath}\n  TestDir: ${testDir}\n  Expected (git): ${gitIgnored}, Got: ${result}`
    );
  }

  suite('when git is unavailable (uses heuristics)', () => {
    setup(async () => {
      mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);
      checker = new GitIgnoreChecker();
      await (checker as any).gitAvailabilityCheck;
    });

    test('should ignore files in node_modules directory', async () => {
      const dir = createNestedDirs(['node_modules']);
      const testFile = path.join(dir, 'test.js');
      await assertIsIgnored(testFile, 'console.log("test");', true, 'node_modules should be ignored by heuristic');
    });

    test('should ignore files in nested node_modules', async () => {
      const dir = createNestedDirs(['src', 'node_modules', 'package']);
      const testFile = path.join(dir, 'index.js');
      await assertIsIgnored(testFile, 'module.exports = {};', true, 'nested node_modules should be ignored by heuristic');
    });

    test('should ignore files in root-level directory starting with .', async () => {
      const dir = createNestedDirs(['.baz']);
      const testFile = path.join(dir, 'x.js');
      await assertIsIgnored(testFile, 'console.log("test");', true, 'root-level .baz should be ignored by heuristic');
    });

    test('should ignore files in root-level directory starting with _', async () => {
      const dir = createNestedDirs(['_private']);
      const testFile = path.join(dir, 'secret.js');
      await assertIsIgnored(testFile, 'console.log("secret");', true, 'root-level _private should be ignored by heuristic');
    });

    test('should not ignore files in non-root-level directory starting with .', async () => {
      const dir = createNestedDirs(['qqq', '.baz']);
      const testFile = path.join(dir, 'x.js');
      await assertIsIgnored(testFile, 'console.log("test");', false, 'non-root .baz should not be ignored by heuristic');
    });

    test('should not ignore files in non-root-level directory starting with _', async () => {
      const dir = createNestedDirs(['qqq', '_private']);
      const testFile = path.join(dir, 'secret.js');
      await assertIsIgnored(testFile, 'console.log("secret");', false, 'non-root _private should not be ignored by heuristic');
    });

    test('should not ignore files in regular directories', async () => {
      const dir = createNestedDirs(['src']);
      const testFile = path.join(dir, 'index.js');
      await assertIsIgnored(testFile, 'console.log("hello");', false, 'regular files should not be ignored by heuristic');
    });

    test('should ignore files in build directory', async () => {
      const dir = createNestedDirs(['build']);
      const testFile = path.join(dir, 'output.js');
      await assertIsIgnored(testFile, 'console.log("build");', true, 'build directory should be ignored by heuristic');
    });

    test('should ignore files in dist directory', async () => {
      const dir = createNestedDirs(['dist']);
      const testFile = path.join(dir, 'bundle.js');
      await assertIsIgnored(testFile, 'console.log("dist");', true, 'dist directory should be ignored by heuristic');
    });

    test('should ignore files in target directory', async () => {
      const dir = createNestedDirs(['target']);
      const testFile = path.join(dir, 'classes.jar');
      await assertIsIgnored(testFile, 'compiled code', true, 'target directory should be ignored by heuristic');
    });

    test('should ignore files in out directory', async () => {
      const dir = createNestedDirs(['out']);
      const testFile = path.join(dir, 'compiled.js');
      await assertIsIgnored(testFile, 'console.log("out");', true, 'out directory should be ignored by heuristic');
    });

    test('should ignore files in vendor directory', async () => {
      const dir = createNestedDirs(['vendor']);
      const testFile = path.join(dir, 'lib.php');
      await assertIsIgnored(testFile, '<?php echo "vendor"; ?>', true, 'vendor directory should be ignored by heuristic');
    });

    test('should ignore files in coverage directory', async () => {
      const dir = createNestedDirs(['coverage']);
      const testFile = path.join(dir, 'lcov.info');
      await assertIsIgnored(testFile, 'coverage data', true, 'coverage directory should be ignored by heuristic');
    });
  });

  suite('when git is available (uses git check-ignore)', () => {
    setup(async () => {
      await initGitRepo(testDir);
      mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);
      checker = new GitIgnoreChecker();
      await (checker as any).gitAvailabilityCheck;
    });

    test('should ignore node_modules when in .gitignore', async () => {
      fs.writeFileSync(path.join(testDir, '.gitignore'), 'node_modules/\n');
      const dir = createNestedDirs(['node_modules']);
      const testFile = path.join(dir, 'test.js');
      await assertIsIgnored(testFile, 'console.log("test");', true, 'node_modules should be ignored when in .gitignore');
      await assertMatchesGitCheckIgnore(testFile, 'console.log("test");');
    });

    test('should not ignore node_modules when not in .gitignore', async () => {
      const dir = createNestedDirs(['node_modules']);
      const testFile = path.join(dir, 'test.js');
      await assertIsIgnored(testFile, 'console.log("test");', false, 'node_modules should not be ignored without .gitignore entry');
      await assertMatchesGitCheckIgnore(testFile, 'console.log("test");');
    });

    test('should not ignore root-level dot directory by default', async () => {
      const dir = createNestedDirs(['.baz']);
      const testFile = path.join(dir, 'x.js');
      await assertIsIgnored(testFile, 'console.log("test");', false, 'dot directories are not ignored by git by default');
      await assertMatchesGitCheckIgnore(testFile, 'console.log("test");');
    });

    test('should ignore root-level dot directory when in .gitignore', async () => {
      fs.writeFileSync(path.join(testDir, '.gitignore'), '.baz/\n');
      const dir = createNestedDirs(['.baz']);
      const testFile = path.join(dir, 'x.js');
      await assertIsIgnored(testFile, 'console.log("test");', true, 'dot directory should be ignored when in .gitignore');
      await assertMatchesGitCheckIgnore(testFile, 'console.log("test");');
    });

    test('should not ignore root-level underscore directory by default', async () => {
      const dir = createNestedDirs(['_private']);
      const testFile = path.join(dir, 'secret.js');
      await assertIsIgnored(testFile, 'console.log("secret");', false, 'underscore directories are not ignored by git by default');
      await assertMatchesGitCheckIgnore(testFile, 'console.log("secret");');
    });

    test('should ignore root-level underscore directory when in .gitignore', async () => {
      fs.writeFileSync(path.join(testDir, '.gitignore'), '_private/\n');
      const dir = createNestedDirs(['_private']);
      const testFile = path.join(dir, 'secret.js');
      await assertIsIgnored(testFile, 'console.log("secret");', true, 'underscore directory should be ignored when in .gitignore');
      await assertMatchesGitCheckIgnore(testFile, 'console.log("secret");');
    });

    test('should not ignore regular files', async () => {
      const dir = createNestedDirs(['src']);
      const testFile = path.join(dir, 'index.js');
      await assertIsIgnored(testFile, 'console.log("hello");', false, 'regular files should not be ignored');
      await assertMatchesGitCheckIgnore(testFile, 'console.log("hello");');
    });

    test('should respect complex .gitignore patterns', async () => {
      fs.writeFileSync(
        path.join(testDir, '.gitignore'),
        'node_modules/\n*.log\nbuild/\n.env\n'
      );

      const nodeModulesFile = path.join(createNestedDirs(['node_modules']), 'package.js');
      await assertIsIgnored(nodeModulesFile, 'module.exports = {};', true, 'node_modules files should be ignored');
      await assertMatchesGitCheckIgnore(nodeModulesFile, 'module.exports = {};');

      const logFile = path.join(testDir, 'debug.log');
      await assertIsIgnored(logFile, 'log content', true, '*.log files should be ignored');
      await assertMatchesGitCheckIgnore(logFile, 'log content');

      const buildFile = path.join(createNestedDirs(['build']), 'output.js');
      await assertIsIgnored(buildFile, 'console.log("build");', true, 'build/ files should be ignored');
      await assertMatchesGitCheckIgnore(buildFile, 'console.log("build");');

      const envFile = path.join(testDir, '.env');
      await assertIsIgnored(envFile, 'SECRET=value', true, '.env files should be ignored');
      await assertMatchesGitCheckIgnore(envFile, 'SECRET=value');

      const regularFile = path.join(createNestedDirs(['src']), 'index.js');
      await assertIsIgnored(regularFile, 'console.log("hello");', false, 'regular files should not be ignored');
      await assertMatchesGitCheckIgnore(regularFile, 'console.log("hello");');
    });

    test('should handle wildcard patterns in .gitignore', async () => {
      fs.writeFileSync(
        path.join(testDir, '.gitignore'),
        '*.tmp\ntest-*\n'
      );

      const tmpFile = path.join(testDir, 'data.tmp');
      await assertIsIgnored(tmpFile, 'temporary data', true, '*.tmp files should be ignored');
      await assertMatchesGitCheckIgnore(tmpFile, 'temporary data');

      const testPrefixFile = path.join(testDir, 'test-file.js');
      await assertIsIgnored(testPrefixFile, 'console.log("test");', true, 'test-* files should be ignored');
      await assertMatchesGitCheckIgnore(testPrefixFile, 'console.log("test");');

      const normalFile = path.join(testDir, 'normal.js');
      await assertIsIgnored(normalFile, 'console.log("normal");', false, 'normal files should not be ignored');
      await assertMatchesGitCheckIgnore(normalFile, 'console.log("normal");');
    });

    test('should handle negation patterns in .gitignore', async () => {
      fs.writeFileSync(
        path.join(testDir, '.gitignore'),
        '*.log\n!important.log\n'
      );

      const ignoredLog = path.join(testDir, 'debug.log');
      await assertIsIgnored(ignoredLog, 'debug log', true, '*.log files should be ignored');
      await assertMatchesGitCheckIgnore(ignoredLog, 'debug log');

      const importantLog = path.join(testDir, 'important.log');
      await assertIsIgnored(importantLog, 'important log', false, 'important.log should not be ignored due to negation');
      await assertMatchesGitCheckIgnore(importantLog, 'important log');
    });

    test('should handle directory-specific patterns', async () => {
      fs.writeFileSync(
        path.join(testDir, '.gitignore'),
        'tests/*.tmp\n'
      );

      const dir = createNestedDirs(['tests']);
      const tmpInTests = path.join(dir, 'data.tmp');
      await assertIsIgnored(tmpInTests, 'test data', true, '*.tmp in tests/ should be ignored');
      await assertMatchesGitCheckIgnore(tmpInTests, 'test data');

      const jsInTests = path.join(dir, 'test.js');
      await assertIsIgnored(jsInTests, 'console.log("test");', false, '.js in tests/ should not be ignored');
      await assertMatchesGitCheckIgnore(jsInTests, 'console.log("test");');

      const tmpInRoot = path.join(testDir, 'root.tmp');
      await assertIsIgnored(tmpInRoot, 'root data', false, '*.tmp in root should not be ignored by tests/*.tmp pattern');
      await assertMatchesGitCheckIgnore(tmpInRoot, 'root data');
    });

    test('should use cache for repeated checks on same file', async () => {
      fs.writeFileSync(path.join(testDir, '.gitignore'), 'ignored.txt\n');
      const testFile = path.join(testDir, 'ignored.txt');
      const mockDocument = createFileAndMockDocument(testFile, 'content');

      const result1 = await (checker as any).isIgnored(mockDocument);
      assert.strictEqual(result1, true, 'First call should return true');

      const result2 = await (checker as any).isIgnored(mockDocument);
      assert.strictEqual(result2, true, 'Second call should return cached true');

      const cacheHasEntry = (checker as any).gitExecutorCache.has(testFile);
      assert.strictEqual(cacheHasEntry, true, 'Cache should contain entry for file');
    });

    test('should clear cache when .gitignore changes', async () => {
      const testFile = path.join(testDir, 'test.txt');
      const mockDocument = createFileAndMockDocument(testFile, 'content');

      const result1 = await (checker as any).isIgnored(mockDocument);
      assert.strictEqual(result1, false, 'File should not be ignored initially');

      let cacheSize = (checker as any).gitExecutorCache.size;
      assert.strictEqual(cacheSize, 1, 'Cache should have one entry');

      (checker as any).clearCache();

      cacheSize = (checker as any).gitExecutorCache.size;
      assert.strictEqual(cacheSize, 0, 'Cache should be empty after clear');
    });
  });
});
