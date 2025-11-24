import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { getStatusChanges, parseGitStatusFilename } from '../../git/git-diff-utils';

suite('Git Diff Utils Test Suite', () => {
  const testRepoPath = path.join(__dirname, '../../../test-git-repo-diff-utils');

  setup(async () => {
    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
    fs.mkdirSync(testRepoPath, { recursive: true });

    const { execSync } = require('child_process');
    execSync('git init', { cwd: testRepoPath });
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath });
    execSync('git config user.name "Test User"', { cwd: testRepoPath });
    execSync('git config advice.defaultBranchName false', { cwd: testRepoPath });

    fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Test Repository');
    fs.writeFileSync(path.join(testRepoPath, 'existing.ts'), 'export const foo = 1;');
    fs.writeFileSync(path.join(testRepoPath, 'to-rename.js'), 'console.log("original");');
    fs.writeFileSync(path.join(testRepoPath, 'to-modify.py'), 'print("original")');
    execSync('git add .', { cwd: testRepoPath });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath });
  });

  teardown(() => {
    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
  });

  suite('parseGitStatusFilename', () => {
    test('parses various filename formats', () => {
      assert.strictEqual(parseGitStatusFilename('?? src/foo.clj'), 'src/foo.clj');
      assert.strictEqual(parseGitStatusFilename('?? "file with spaces.ts"'), 'file with spaces.ts');
      assert.strictEqual(parseGitStatusFilename('M  src/bar.js'), 'src/bar.js');
      assert.strictEqual(parseGitStatusFilename('A  newfile.py'), 'newfile.py');
      assert.strictEqual(parseGitStatusFilename('MM modified.rs'), 'modified.rs');
      assert.strictEqual(parseGitStatusFilename('invalid'), null);
    });

    test('parses renamed files', () => {
      assert.strictEqual(parseGitStatusFilename('R  old-name.ts -> new-name.ts'), 'new-name.ts');
      assert.strictEqual(parseGitStatusFilename('R  "old name.ts" -> "new name.ts"'), 'new name.ts');
    });
  });

  suite('getStatusChanges', () => {
    test('detects all file statuses: ??, A, M, MM, AM, R, C', async () => {
      const { execSync } = require('child_process');

      fs.writeFileSync(path.join(testRepoPath, 'untracked.ts'), 'export const x = 1;');

      fs.writeFileSync(path.join(testRepoPath, 'added.js'), 'console.log("new");');
      execSync('git add added.js', { cwd: testRepoPath });

      fs.writeFileSync(path.join(testRepoPath, 'to-modify.py'), 'print("modified")');

      fs.writeFileSync(path.join(testRepoPath, 'existing.ts'), 'export const foo = 2;');
      execSync('git add existing.ts', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'existing.ts'), 'export const foo = 3;');

      fs.writeFileSync(path.join(testRepoPath, 'new-modified.ts'), 'export const a = 1;');
      execSync('git add new-modified.ts', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'new-modified.ts'), 'export const a = 2;');

      fs.renameSync(path.join(testRepoPath, 'to-rename.js'), path.join(testRepoPath, 'renamed.js'));
      execSync('git add -A', { cwd: testRepoPath });

      execSync('git config core.ignoreCase false', { cwd: testRepoPath });
      const srcPath = path.join(testRepoPath, 'README.md');
      const copiedPath = path.join(testRepoPath, 'copied.md');
      fs.copyFileSync(srcPath, copiedPath);
      execSync('git add -A', { cwd: testRepoPath });

      const changes = await getStatusChanges(testRepoPath);
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('untracked.ts'), 'Should detect ?? status');
      assert.ok(fileNames.includes('added.js'), 'Should detect A status');
      assert.ok(fileNames.includes('to-modify.py'), 'Should detect M status');
      assert.ok(fileNames.includes('existing.ts'), 'Should detect MM status');
      assert.ok(fileNames.includes('new-modified.ts'), 'Should detect AM status');
      assert.ok(fileNames.includes('renamed.js'), 'Should detect R status (new name)');
      assert.ok(fileNames.includes('copied.md'), 'Should detect C or A status (copied file)');
    });

    test('detects files with whitespace in various statuses: ??, A, M, MM, AM, R, C', async () => {
      const { execSync } = require('child_process');

      // === Phase 1: Commit files needed for M, MM, R ===

      fs.writeFileSync(path.join(testRepoPath, 'spaced file.ts'), 'export const x = 1;');
      execSync('git add "spaced file.ts"', { cwd: testRepoPath });

      fs.writeFileSync(path.join(testRepoPath, 'original name.ts'), 'export const y = 1;');
      execSync('git add "original name.ts"', { cwd: testRepoPath });

      fs.writeFileSync(path.join(testRepoPath, 'staged modified.rs'), 'fn main() { }');
      execSync('git add "staged modified.rs"', { cwd: testRepoPath });

      fs.writeFileSync(path.join(testRepoPath, 'source file.md'), '# Source');
      execSync('git add "source file.md"', { cwd: testRepoPath });

      execSync('git commit -m "Add files for testing"', { cwd: testRepoPath });

      // === Phase 2: Create the actual statuses ===

      fs.writeFileSync(path.join(testRepoPath, 'spaced file.ts'), 'export const x = 2;');

      fs.renameSync(path.join(testRepoPath, 'original name.ts'), path.join(testRepoPath, 'new name.ts'));
      execSync('git add -A', { cwd: testRepoPath });

      fs.writeFileSync(path.join(testRepoPath, 'staged modified.rs'), 'fn main() { let x = 1; }');
      execSync('git add "staged modified.rs"', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'staged modified.rs'), 'fn main() { let x = 2; }');

      fs.copyFileSync(path.join(testRepoPath, 'source file.md'), path.join(testRepoPath, 'copied file.md'));
      execSync('git add "copied file.md"', { cwd: testRepoPath });

      fs.writeFileSync(path.join(testRepoPath, 'untracked file.ts'), 'export const x = 1;');

      fs.writeFileSync(path.join(testRepoPath, 'staged file.py'), 'print("hello")');
      execSync('git add "staged file.py"', { cwd: testRepoPath });

      fs.writeFileSync(path.join(testRepoPath, 'new modified file.js'), 'console.log(1);');
      execSync('git add "new modified file.js"', { cwd: testRepoPath });
      fs.writeFileSync(path.join(testRepoPath, 'new modified file.js'), 'console.log(2);');

      const changes = await getStatusChanges(testRepoPath);
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('untracked file.ts'), 'Should detect ?? with spaces');
      assert.ok(fileNames.includes('staged file.py'), 'Should detect A with spaces');
      assert.ok(fileNames.includes('spaced file.ts'), 'Should detect M with spaces');
      assert.ok(fileNames.includes('staged modified.rs'), 'Should detect MM with spaces');
      assert.ok(fileNames.includes('new modified file.js'), 'Should detect AM with spaces');
      assert.ok(fileNames.includes('new name.ts'), 'Should detect R with spaces');
      assert.ok(fileNames.includes('copied file.md'), 'Should detect C or A with spaces');
    });

    test('returns empty set for clean repository and excludes deleted files', async () => {
      let changes = await getStatusChanges(testRepoPath);
      assert.strictEqual(changes.size, 0, 'Should return empty set for clean repo');

      fs.unlinkSync(path.join(testRepoPath, 'existing.ts'));
      changes = await getStatusChanges(testRepoPath);
      const fileNames = Array.from(changes);
      assert.ok(!fileNames.includes('existing.ts'), 'Should not include deleted file');
    });
  });
});
