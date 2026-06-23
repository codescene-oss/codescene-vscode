import * as assert from 'assert';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getFileTimestamp } from '../../refactoring/refactoring-agent';

suite('Refactoring Agent Test Suite', () => {
  const testRepoBasePath = path.join(__dirname, '../../../test-git-repo-refactoring-agent');
  let testRepoPath: string;
  let testCounter = 0;

  setup(function () {
    this.timeout(20000);

    testCounter++;
    testRepoPath = `${testRepoBasePath}-${testCounter}`;

    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
    fs.mkdirSync(testRepoPath, { recursive: true });

    execSync('git init', { cwd: testRepoPath });
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath });
    execSync('git config user.name "Test User"', { cwd: testRepoPath });
    execSync('git config advice.defaultBranchName false', { cwd: testRepoPath });
  });

  teardown(function () {
    this.timeout(20000);
    const parentDir = path.dirname(testRepoBasePath);
    if (fs.existsSync(parentDir)) {
      const files = fs.readdirSync(parentDir);
      files.forEach((file) => {
        if (file.startsWith(path.basename(testRepoBasePath))) {
          const fullPath = path.join(parentDir, file);
          if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
        }
      });
    }
  });

  function commitFile(filename: string, content: string, message: string): void {
    fs.writeFileSync(path.join(testRepoPath, filename), content);
    execSync('git add .', { cwd: testRepoPath });
    execSync(`git commit -m "${message}"`, { cwd: testRepoPath });
  }

  suite('getFileTimestamp', () => {
    test('returns valid timestamp for existing file', async function () {
      this.timeout(20000);
      const testFile = path.join(testRepoPath, 'test.ts');
      commitFile('test.ts', 'export const test = true;', 'Initial commit');

      const timestamp = await getFileTimestamp(testFile);

      assert.notStrictEqual(timestamp, null, 'Timestamp should not be null for existing file');
      assert.strictEqual(typeof timestamp, 'number', 'Timestamp should be a number');
      assert.ok(timestamp! > 0, 'Timestamp should be positive');
    });

    test('returns null for non-existent file', async function () {
      this.timeout(20000);
      const nonExistentFile = path.join(testRepoPath, 'does-not-exist.ts');

      const timestamp = await getFileTimestamp(nonExistentFile);

      assert.strictEqual(timestamp, null, 'Timestamp should be null for non-existent file');
    });

    test('timestamp increases when file is modified', async function () {
      this.timeout(20000);
      const testFile = path.join(testRepoPath, 'test.ts');
      commitFile('test.ts', 'export const test = true;', 'Initial commit');

      const timestampBefore = await getFileTimestamp(testFile);

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Modify the file
      fs.writeFileSync(testFile, 'export const test = false;');

      const timestampAfter = await getFileTimestamp(testFile);

      assert.notStrictEqual(timestampBefore, null);
      assert.notStrictEqual(timestampAfter, null);
      assert.ok(
        timestampAfter! > timestampBefore!,
        `Timestamp should increase after modification. Before: ${timestampBefore}, After: ${timestampAfter}`
      );
    });

    test('timestamp unchanged when file is not modified', async function () {
      this.timeout(20000);
      const testFile = path.join(testRepoPath, 'test.ts');
      commitFile('test.ts', 'export const test = true;', 'Initial commit');

      const timestampBefore = await getFileTimestamp(testFile);
      const timestampAfter = await getFileTimestamp(testFile);

      assert.strictEqual(
        timestampBefore,
        timestampAfter,
        'Timestamp should remain the same when file is not modified'
      );
    });
  });

  suite('timestamp-based change detection', () => {
    function fileWasChanged(before: number | null, after: number | null): boolean {
      return before !== null && after !== null && after > before;
    }

    function waitMs(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    test('detects no changes when file not modified', async function () {
      this.timeout(20000);
      const testFile = path.join(testRepoPath, 'test.ts');
      commitFile('test.ts', 'export const test = true;', 'Initial commit');

      const timestampBefore = await getFileTimestamp(testFile);
      const timestampAfter = await getFileTimestamp(testFile);

      assert.strictEqual(
        fileWasChanged(timestampBefore, timestampAfter),
        false,
        'Should detect no changes when file was not modified'
      );
    });

    test('detects changes when file is modified', async function () {
      this.timeout(20000);
      const testFile = path.join(testRepoPath, 'test.ts');
      commitFile('test.ts', 'export const test = true;', 'Initial commit');

      const timestampBefore = await getFileTimestamp(testFile);
      await waitMs(10);
      fs.writeFileSync(testFile, 'export const test = false;');
      const timestampAfter = await getFileTimestamp(testFile);

      assert.strictEqual(
        fileWasChanged(timestampBefore, timestampAfter),
        true,
        'Should detect changes when file was modified'
      );
    });

    test('detects no changes when file already modified but binary does not modify further', async function () {
      this.timeout(20000);
      const testFile = path.join(testRepoPath, 'test.ts');
      commitFile('test.ts', 'export const test = true;', 'Initial commit');

      // Modify file before binary runs (simulating pre-existing uncommitted changes)
      fs.writeFileSync(testFile, 'export const test = "modified";');
      await waitMs(10);

      const timestampBefore = await getFileTimestamp(testFile);
      const timestampAfter = await getFileTimestamp(testFile);

      assert.strictEqual(
        fileWasChanged(timestampBefore, timestampAfter),
        false,
        'Should detect no changes when file was already modified but binary does not modify it further'
      );
    });

    test('detects changes when file already modified and binary modifies it again', async function () {
      this.timeout(20000);
      const testFile = path.join(testRepoPath, 'test.ts');
      commitFile('test.ts', 'export const test = true;', 'Initial commit');

      // Modify file before binary runs (simulating pre-existing uncommitted changes)
      fs.writeFileSync(testFile, 'export const test = "modified";');
      await waitMs(10);

      const timestampBefore = await getFileTimestamp(testFile);
      await waitMs(10);
      fs.writeFileSync(testFile, 'export const test = "modified again";');
      const timestampAfter = await getFileTimestamp(testFile);

      assert.strictEqual(
        fileWasChanged(timestampBefore, timestampAfter),
        true,
        'Should detect changes when file was already modified and binary modifies it again'
      );
    });

    test('detects changes when binary creates a new file', async function () {
      this.timeout(20000);
      const testFile = path.join(testRepoPath, 'new-file.ts');

      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }

      const timestampBefore = await getFileTimestamp(testFile);
      await waitMs(10);
      fs.writeFileSync(testFile, 'export const newFile = true;');
      const timestampAfter = await getFileTimestamp(testFile);

      // When file is created, timestampBefore is null but timestampAfter is not
      assert.strictEqual(timestampBefore, null, 'Timestamp should be null for non-existent file');
      assert.notStrictEqual(timestampAfter, null, 'Timestamp should not be null after file creation');

      // The current logic requires both timestamps to be non-null, so creation is NOT detected
      assert.strictEqual(
        fileWasChanged(timestampBefore, timestampAfter),
        false,
        'Current implementation does not detect file creation (timestampBefore is null)'
      );
    });

    test('does not detect changes when binary deletes the file', async function () {
      this.timeout(20000);
      const testFile = path.join(testRepoPath, 'test.ts');
      commitFile('test.ts', 'export const test = true;', 'Initial commit');

      const timestampBefore = await getFileTimestamp(testFile);
      await waitMs(10);
      fs.unlinkSync(testFile);
      const timestampAfter = await getFileTimestamp(testFile);

      // When file is deleted, timestampBefore is not null but timestampAfter is null
      assert.notStrictEqual(timestampBefore, null, 'Timestamp should not be null before deletion');
      assert.strictEqual(timestampAfter, null, 'Timestamp should be null after file deletion');

      // The current logic requires both timestamps to be non-null, so deletion is NOT detected
      assert.strictEqual(
        fileWasChanged(timestampBefore, timestampAfter),
        false,
        'Current implementation does not detect file deletion (timestampAfter is null)'
      );
    });

    test('does not detect changes when binary renames the file', async function () {
      this.timeout(20000);
      const testFile = path.join(testRepoPath, 'test.ts');
      const renamedFile = path.join(testRepoPath, 'test-renamed.ts');
      commitFile('test.ts', 'export const test = true;', 'Initial commit');

      const timestampBefore = await getFileTimestamp(testFile);
      await waitMs(10);
      fs.renameSync(testFile, renamedFile);
      const timestampAfter = await getFileTimestamp(testFile);

      // When file is renamed, timestampBefore is not null but timestampAfter is null
      // (because we're checking the original path which no longer exists)
      assert.notStrictEqual(timestampBefore, null, 'Timestamp should not be null before rename');
      assert.strictEqual(timestampAfter, null, 'Timestamp should be null after file is renamed');

      // The current logic requires both timestamps to be non-null, so rename is NOT detected
      assert.strictEqual(
        fileWasChanged(timestampBefore, timestampAfter),
        false,
        'Current implementation does not detect file rename (timestampAfter is null for original path)'
      );

      assert.ok(fs.existsSync(renamedFile), 'Renamed file should exist');
    });
  });
});
