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

    const heuristicTestCases = [
      { name: 'node_modules directory', dirs: ['node_modules'], file: 'test.js', ignored: true },
      { name: 'nested node_modules', dirs: ['src', 'node_modules', 'package'], file: 'index.js', ignored: true },
      { name: 'root-level directory starting with .', dirs: ['.baz'], file: 'x.js', ignored: true },
      { name: 'root-level directory starting with _', dirs: ['_private'], file: 'secret.js', ignored: true },
      { name: 'non-root-level directory starting with .', dirs: ['qqq', '.baz'], file: 'x.js', ignored: false },
      { name: 'non-root-level directory starting with _', dirs: ['qqq', '_private'], file: 'secret.js', ignored: false },
      { name: 'regular directories', dirs: ['src'], file: 'index.js', ignored: false },
      { name: 'build directory', dirs: ['build'], file: 'output.js', ignored: true },
      { name: 'dist directory', dirs: ['dist'], file: 'bundle.js', ignored: true },
      { name: 'target directory', dirs: ['target'], file: 'classes.jar', ignored: true },
      { name: 'out directory', dirs: ['out'], file: 'compiled.js', ignored: true },
      { name: 'vendor directory', dirs: ['vendor'], file: 'lib.php', ignored: true },
      { name: 'coverage directory', dirs: ['coverage'], file: 'lcov.info', ignored: true },
    ];

    heuristicTestCases.forEach(({ name, dirs, file, ignored }) => {
      test(`should ${ignored ? 'ignore' : 'not ignore'} files in ${name}`, async () => {
        const dir = createNestedDirs(dirs);
        const testFile = path.join(dir, file);
        await assertIsIgnored(testFile, 'content', ignored, `${name} should ${ignored ? '' : 'not '}be ignored by heuristic`);
      });
    });
  });

  suite('when git is available (uses git check-ignore)', () => {
    setup(async () => {
      await initGitRepo(testDir);
      mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);
      checker = new GitIgnoreChecker();
      await (checker as any).gitAvailabilityCheck;
    });

    const gitignorePatternTests = [
      { name: 'node_modules when in .gitignore', gitignore: 'node_modules/\n', dirs: ['node_modules'], file: 'test.js', ignored: true },
      { name: 'node_modules when not in .gitignore', gitignore: '', dirs: ['node_modules'], file: 'test.js', ignored: false },
      { name: 'root-level dot directory by default', gitignore: '', dirs: ['.baz'], file: 'x.js', ignored: false },
      { name: 'root-level dot directory when in .gitignore', gitignore: '.baz/\n', dirs: ['.baz'], file: 'x.js', ignored: true },
      { name: 'root-level underscore directory by default', gitignore: '', dirs: ['_private'], file: 'secret.js', ignored: false },
      { name: 'root-level underscore directory when in .gitignore', gitignore: '_private/\n', dirs: ['_private'], file: 'secret.js', ignored: true },
      { name: 'regular files', gitignore: '', dirs: ['src'], file: 'index.js', ignored: false },
      { name: 'files with spaces in name (matching)', gitignore: '*.log\n', dirs: ['logs'], file: 'my debug file.log', ignored: true },
      { name: 'files with spaces in name (not matching)', gitignore: '*.log\n', dirs: ['logs'], file: 'my source file.ts', ignored: false },
      ...(process.platform !== 'win32' ? [
        { name: 'files with newlines in name (matching)', gitignore: '*.log\n', dirs: [] as string[], file: 'file\nwith\nnewlines.log', ignored: true },
        { name: 'files with newlines in name (not matching)', gitignore: '*.log\n', dirs: [] as string[], file: 'file\nwith\nnewlines.ts', ignored: false },
      ] : []),
      { name: 'directories with spaces in path', gitignore: 'build/\n', dirs: ['my project', 'build'], file: 'output.js', ignored: true },
      { name: 'deeply nested paths', gitignore: '*.log\n', dirs: ['a', 'b', 'c', 'd', 'e', 'f'], file: 'deep.log', ignored: true },
      { name: 'absolute paths', gitignore: '*.tmp\n', dirs: [], file: 'cache.tmp', ignored: true },
    ];

    gitignorePatternTests.forEach(({ name, gitignore, dirs, file, ignored }) => {
      test(`should handle ${name}`, async () => {
        if (gitignore) {
          fs.writeFileSync(path.join(testDir, '.gitignore'), gitignore);
        }
        const dir = dirs.length > 0 ? createNestedDirs(dirs) : testDir;
        const testFile = path.join(dir, file);
        await assertIsIgnored(testFile, 'content', ignored, name);
        await assertMatchesGitCheckIgnore(testFile, 'content');
      });
    });

    test('should respect complex .gitignore patterns', async function () {
      this.timeout(5000);
      fs.writeFileSync(path.join(testDir, '.gitignore'), 'node_modules/\n*.log\nbuild/\n.env\n');

      const cases = [
        { dirs: ['node_modules'], file: 'package.js', ignored: true },
        { dirs: [], file: 'debug.log', ignored: true },
        { dirs: ['build'], file: 'output.js', ignored: true },
        { dirs: [], file: '.env', ignored: true },
        { dirs: ['src'], file: 'index.js', ignored: false },
      ];

      for (const { dirs } of cases) {
        if (dirs.length > 0) createNestedDirs(dirs);
      }

      const testFiles = cases.map(({ dirs, file }) => {
        const dir = dirs.length > 0 ? path.join(testDir, ...dirs) : testDir;
        return path.join(dir, file);
      });

      await Promise.all(
        cases.map(async ({ ignored }, i) => {
          await assertIsIgnored(testFiles[i], 'content', ignored, `${cases[i].file} should ${ignored ? '' : 'not '}be ignored`);
        })
      );

      await Promise.all(
        testFiles.map(async (testFile) => {
          await assertMatchesGitCheckIgnore(testFile, 'content');
        })
      );
    });

    test('should handle wildcard and negation patterns', async function () {
      this.timeout(5000);
      fs.writeFileSync(path.join(testDir, '.gitignore'), '*.tmp\ntest-*\n*.log\n!important.log\n');

      const cases = [
        { file: 'data.tmp', ignored: true },
        { file: 'test-file.js', ignored: true },
        { file: 'normal.js', ignored: false },
        { file: 'debug.log', ignored: true },
        { file: 'important.log', ignored: false },
      ];

      const testFiles = cases.map(({ file }) => path.join(testDir, file));

      await Promise.all(
        cases.map(async ({ ignored }, i) => {
          await assertIsIgnored(testFiles[i], 'content', ignored, `${cases[i].file} should ${ignored ? '' : 'not '}be ignored`);
        })
      );

      await Promise.all(
        testFiles.map(async (testFile) => {
          await assertMatchesGitCheckIgnore(testFile, 'content');
        })
      );
    });

    test('should handle directory-specific patterns', async function () {
      this.timeout(5000);
      fs.writeFileSync(path.join(testDir, '.gitignore'), 'tests/*.tmp\n');
      const testsDir = createNestedDirs(['tests']);

      const cases = [
        { dir: testsDir, file: 'data.tmp', ignored: true },
        { dir: testsDir, file: 'test.js', ignored: false },
        { dir: testDir, file: 'root.tmp', ignored: false },
      ];

      const testFiles = cases.map(({ dir, file }) => path.join(dir, file));

      await Promise.all(
        cases.map(async ({ ignored }, i) => {
          await assertIsIgnored(testFiles[i], 'content', ignored, `${cases[i].file} should ${ignored ? '' : 'not '}be ignored`);
        })
      );

      await Promise.all(
        testFiles.map(async (testFile) => {
          await assertMatchesGitCheckIgnore(testFile, 'content');
        })
      );
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

    test('should batch multiple concurrent checks into single git call', async () => {
      fs.writeFileSync(path.join(testDir, '.gitignore'), '*.log\nnode_modules/\n');

      const files = [
        { path: path.join(testDir, 'app.ts'), ignored: false },
        { path: path.join(testDir, 'debug.log'), ignored: true },
        { path: path.join(createNestedDirs(['node_modules']), 'pkg.js'), ignored: true },
        { path: path.join(testDir, 'index.js'), ignored: false },
        { path: path.join(testDir, 'error.log'), ignored: true },
      ];

      const mockDocuments = files.map(({ path: filePath }) => createFileAndMockDocument(filePath, 'content'));
      const promises = mockDocuments.map((doc) => (checker as any).isIgnored(doc));
      const results = await Promise.all(promises);

      files.forEach(({ path: filePath, ignored }, i) => {
        assert.strictEqual(results[i], ignored, `${filePath} should ${ignored ? '' : 'not '}be ignored`);
      });
    });

    test('should create separate batches for time-separated requests', async function () {
      this.timeout(5000);
      fs.writeFileSync(path.join(testDir, '.gitignore'), '*.log\n*.tmp\n');

      let flushCount = 0;
      const originalFlush = (checker as any).flushPendingChecks.bind(checker);
      (checker as any).flushPendingChecks = async function () {
        flushCount++;
        return originalFlush();
      };

      const batch1Doc = createFileAndMockDocument(path.join(testDir, 'first.log'), 'content');
      const batch1Result = await (checker as any).isIgnored(batch1Doc);
      assert.strictEqual(batch1Result, true);
      assert.strictEqual(flushCount, 1, 'First batch should have flushed');

      // Wait longer than BATCH_DELAY_MS so next request starts a new batch
      const batchDelayMs = (GitIgnoreChecker as any).BATCH_DELAY_MS;
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs + 50));

      const batch2Doc = createFileAndMockDocument(path.join(testDir, 'second.tmp'), 'content');
      const batch2Result = await (checker as any).isIgnored(batch2Doc);
      assert.strictEqual(batch2Result, true);
      assert.strictEqual(flushCount, 2, 'Second batch should have flushed separately');
    });
  });
});
