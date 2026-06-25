import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FilteringReviewer } from '../../review/filtering-reviewer';
import {
  mockWorkspaceFolders,
  createMockWorkspaceFolder,
  restoreDefaultWorkspaceFolders,
} from '../setup';
import { resetGitAvailability } from '../../git/git-detection';
import { disposeSharedGitIgnoreChecker } from '../../git/git-ignore-checker';

suite('FilteringReviewer Test Suite', () => {
  let testDir: string;
  let reviewer: FilteringReviewer;

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
    disposeSharedGitIgnoreChecker();
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
    const result = await (reviewer as any).gitIgnoreChecker.isIgnored(mockDocument);
    assert.strictEqual(
      result,
      expected,
      `${message}\n  File: ${filePath}\n  TestDir: ${testDir}\n  Expected: ${expected}, Got: ${result}`
    );
  }

  suite('when git is unavailable (uses heuristics)', () => {
    setup(async () => {
      disposeSharedGitIgnoreChecker();
      mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);
      reviewer = new FilteringReviewer();
      await (reviewer as any).gitIgnoreChecker.gitAvailabilityCheck;
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
});
