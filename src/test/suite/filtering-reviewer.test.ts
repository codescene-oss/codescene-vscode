import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { FilteringReviewer } from '../../review/filtering-reviewer';
import {
  mockWorkspaceFolders,
  createMockWorkspaceFolder,
  restoreDefaultWorkspaceFolders,
} from '../setup';
import { resetGitAvailability } from '../../git/git-detection';

const execAsync = promisify(exec);

suite('FilteringReviewer Test Suite', () => {
  let testDir: string;
  let reviewer: FilteringReviewer;

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
    testDir = fs.mkdtempSync(path.join(testBaseDir, 'filtering-reviewer-test-'));
  });

  teardown(() => {
    if (reviewer) {
      reviewer.dispose();
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
    const result = await (reviewer as any).isIgnored(mockDocument);
    assert.strictEqual(
      result,
      expected,
      `${message}\n  File: ${filePath}\n  TestDir: ${testDir}\n  Expected: ${expected}, Got: ${result}`
    );
  }

  async function assertMatchesGitCheckIgnore(filePath: string, content: string) {
    const mockDocument = createFileAndMockDocument(filePath, content);
    const result = await (reviewer as any).isIgnored(mockDocument);

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
      reviewer = new FilteringReviewer();
      await (reviewer as any).gitAvailabilityCheck;
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
  });

  suite('when git is available (uses git check-ignore)', () => {
    setup(async () => {
      await initGitRepo(testDir);
      mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);
      reviewer = new FilteringReviewer();
      await (reviewer as any).gitAvailabilityCheck;
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
  });
});
