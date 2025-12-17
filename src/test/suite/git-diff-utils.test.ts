import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { getStatusChanges, getCommittedChanges, parseGitStatusFilename, createWorkspacePrefix, isFileInWorkspace } from '../../git/git-diff-utils';

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

  suite('createWorkspacePrefix', () => {
    test('adds separator to path without trailing separator', () => {
      const inputPath = path.join(path.sep, 'foo', 'bar');
      const result = createWorkspacePrefix(inputPath);
      const resolvedPath = path.resolve(inputPath);
      assert.strictEqual(result.workspacePrefix, `${resolvedPath}${path.sep}`);
      assert.strictEqual(result.normalizedWorkspacePath, resolvedPath);
    });

    test('preserves separator for path with trailing separator', () => {
      const inputPath = path.join(path.sep, 'foo', 'bar') + path.sep;
      const result = createWorkspacePrefix(inputPath);
      const resolvedPath = path.resolve(inputPath) + path.sep;
      assert.strictEqual(result.workspacePrefix, resolvedPath);
    });
  });

  suite('isFileInWorkspace', () => {
    test('returns true for file inside workspace', () => {
      const repoPath = path.join(path.sep, 'repo');
      const workspacePath = path.join(repoPath, 'workspace');
      const { normalizedWorkspacePath, workspacePrefix } = createWorkspacePrefix(workspacePath);
      const filePath = 'workspace/file.ts';
      const normalizedFile = path.normalize(filePath);
      const absolutePath = path.resolve(path.normalize(repoPath), normalizedFile);
      const result = isFileInWorkspace(filePath, repoPath, normalizedWorkspacePath, workspacePrefix);
      assert.ok(result, `Expected file to be in workspace. filePath: ${filePath}, repoPath: ${repoPath}, normalizedWorkspacePath: ${normalizedWorkspacePath}, workspacePrefix: ${workspacePrefix}`);
    });

    test('returns false for file outside workspace', () => {
      const repoPath = path.join(path.sep, 'repo');
      const workspacePath = path.join(repoPath, 'workspace');
      const { normalizedWorkspacePath, workspacePrefix } = createWorkspacePrefix(workspacePath);
      const filePath = 'other/file.ts';
      const result = isFileInWorkspace(filePath, repoPath, normalizedWorkspacePath, workspacePrefix);
      assert.ok(!result, `Expected file to be outside workspace. filePath: ${filePath}, repoPath: ${repoPath}, normalizedWorkspacePath: ${normalizedWorkspacePath}, workspacePrefix: ${workspacePrefix}`);
    });

    test('returns false for file with similar prefix', () => {
      const repoPath = path.join(path.sep, 'repo');
      const workspacePath = path.join(repoPath, 'workspace');
      const { normalizedWorkspacePath, workspacePrefix } = createWorkspacePrefix(workspacePath);
      const filePath = 'workspace-other/file.ts';
      const result = isFileInWorkspace(filePath, repoPath, normalizedWorkspacePath, workspacePrefix);
      assert.ok(!result, `Expected file to be outside workspace. filePath: ${filePath}, repoPath: ${repoPath}, normalizedWorkspacePath: ${normalizedWorkspacePath}, workspacePrefix: ${workspacePrefix}`);
    });
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

      const changes = await getStatusChanges(testRepoPath, testRepoPath);
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

      const changes = await getStatusChanges(testRepoPath, testRepoPath);
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
      let changes = await getStatusChanges(testRepoPath, testRepoPath);
      assert.strictEqual(changes.size, 0, 'Should return empty set for clean repo');

      fs.unlinkSync(path.join(testRepoPath, 'existing.ts'));
      changes = await getStatusChanges(testRepoPath, testRepoPath);
      const fileNames = Array.from(changes);
      assert.ok(!fileNames.includes('existing.ts'), 'Should not include deleted file');
    });

    test('filters files outside workspacePath when gitRootPath differs', async () => {
      const { execSync } = require('child_process');

      const subDir = path.join(testRepoPath, 'workspace-subdir');
      fs.mkdirSync(subDir, { recursive: true });

      fs.writeFileSync(path.join(subDir, 'inside.ts'), 'export const inside = 1;');

      fs.writeFileSync(path.join(testRepoPath, 'outside.ts'), 'export const outside = 1;');

      const changes = await getStatusChanges(testRepoPath, subDir);
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('inside.ts'), 'Should include file inside workspacePath with workspace prefix stripped');

      assert.ok(!fileNames.includes('outside.ts'), 'Should not include file outside workspacePath');
      assert.ok(!fileNames.includes('workspace-subdir/inside.ts'), 'Should strip workspace prefix from paths');
    });

    test('handles workspacePath with trailing slash', async () => {
      const workspaceDir = path.join(testRepoPath, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });

      fs.writeFileSync(path.join(workspaceDir, 'file.ts'), 'export const a = 1;');

      const workspacePathWithSlash = workspaceDir + path.sep;
      const changes = await getStatusChanges(testRepoPath, workspacePathWithSlash);
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('file.ts'), 'Should handle workspacePath with trailing slash and strip prefix');
    });

    test('filters and strips prefix for files with same name in different locations', async () => {
      const uiDir = path.join(testRepoPath, 'ui');
      fs.mkdirSync(uiDir, { recursive: true });

      fs.writeFileSync(path.join(testRepoPath, 'gc.cpp'), '// bad gc.cpp at root');

      fs.writeFileSync(path.join(uiDir, 'gc.cpp'), '// good gc.cpp in ui');

      const changes = await getStatusChanges(testRepoPath, uiDir);
      const fileNames = Array.from(changes);

      assert.strictEqual(fileNames.length, 1, 'Should only include one gc.cpp file');
      assert.ok(fileNames.includes('gc.cpp'), 'Should include gc.cpp from ui directory with prefix stripped');

      const returnedFilePath = path.join(uiDir, fileNames[0]);
      const content = fs.readFileSync(returnedFilePath, 'utf8');
      assert.ok(content.includes('good gc.cpp in ui'), 'Should return the gc.cpp from ui directory with good content');
      assert.ok(!content.includes('bad gc.cpp at root'), 'Should not return the gc.cpp from root with bad content');
    });
  });

  suite('getCommittedChanges', () => {
    test('filters committed files outside workspacePath when gitRootPath differs', async () => {
      const { execSync } = require('child_process');

      const workspaceDir = path.join(testRepoPath, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });

      fs.writeFileSync(path.join(workspaceDir, 'inside.ts'), 'export const inside = 1;');
      execSync('git add workspace/inside.ts', { cwd: testRepoPath });
      execSync('git commit -m "Add inside file"', { cwd: testRepoPath });

      const baseCommit = execSync('git rev-parse HEAD~1', { cwd: testRepoPath }).toString().trim();

      fs.writeFileSync(path.join(testRepoPath, 'outside.ts'), 'export const outside = 1;');
      execSync('git add outside.ts', { cwd: testRepoPath });
      execSync('git commit -m "Add outside file"', { cwd: testRepoPath });

      const changes = await getCommittedChanges(testRepoPath, baseCommit, workspaceDir);
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('inside.ts'), 'Should include committed file inside workspacePath with prefix stripped');

      assert.ok(!fileNames.includes('outside.ts'), 'Should not include committed file outside workspacePath');
      assert.ok(!fileNames.includes('workspace/inside.ts'), 'Should strip workspace prefix from paths');
    });

    test('handles committed files with trailing slash in workspacePath', async () => {
      const { execSync } = require('child_process');

      const workspaceDir = path.join(testRepoPath, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });

      const baseCommit = execSync('git rev-parse HEAD', { cwd: testRepoPath }).toString().trim();

      fs.writeFileSync(path.join(workspaceDir, 'file.ts'), 'export const a = 1;');
      execSync('git add workspace/file.ts', { cwd: testRepoPath });
      execSync('git commit -m "Add file"', { cwd: testRepoPath });

      const workspacePathWithSlash = workspaceDir + path.sep;
      const changes = await getCommittedChanges(testRepoPath, baseCommit, workspacePathWithSlash);
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('file.ts'), 'Should handle committed files with trailing slash in workspacePath and strip prefix');
    });

    test('returns empty set when baseCommit is empty', async () => {
      const changes = await getCommittedChanges(testRepoPath, '', testRepoPath);
      assert.strictEqual(changes.size, 0, 'Should return empty set when baseCommit is empty');
    });

    test('filters and strips prefix for committed files with same name in different locations', async () => {
      const { execSync } = require('child_process');

      const uiDir = path.join(testRepoPath, 'ui');
      fs.mkdirSync(uiDir, { recursive: true });

      const baseCommit = execSync('git rev-parse HEAD', { cwd: testRepoPath }).toString().trim();

      fs.writeFileSync(path.join(testRepoPath, 'gc.cpp'), '// bad gc.cpp at root');
      execSync('git add gc.cpp', { cwd: testRepoPath });
      execSync('git commit -m "Add gc.cpp at root"', { cwd: testRepoPath });

      fs.writeFileSync(path.join(uiDir, 'gc.cpp'), '// good gc.cpp in ui');
      execSync('git add ui/gc.cpp', { cwd: testRepoPath });
      execSync('git commit -m "Add gc.cpp in ui"', { cwd: testRepoPath });

      const changes = await getCommittedChanges(testRepoPath, baseCommit, uiDir);
      const fileNames = Array.from(changes);

      assert.strictEqual(fileNames.length, 1, 'Should only include one gc.cpp file');
      assert.ok(fileNames.includes('gc.cpp'), 'Should include gc.cpp from ui directory with prefix stripped');

      const returnedFilePath = path.join(uiDir, fileNames[0]);
      const content = fs.readFileSync(returnedFilePath, 'utf8');
      assert.ok(content.includes('good gc.cpp in ui'), 'Should return the gc.cpp from ui directory with good content');
      assert.ok(!content.includes('bad gc.cpp at root'), 'Should not return the gc.cpp from root with bad content');
    });

    test('returns all committed files when gitRootPath equals workspacePath', async () => {
      const { execSync } = require('child_process');

      const baseCommit = execSync('git rev-parse HEAD', { cwd: testRepoPath }).toString().trim();

      fs.writeFileSync(path.join(testRepoPath, 'root-file.ts'), 'export const a = 1;');
      const subDir = path.join(testRepoPath, 'subdir');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'sub-file.ts'), 'export const b = 1;');

      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Add multiple files"', { cwd: testRepoPath });

      const changes = await getCommittedChanges(testRepoPath, baseCommit, testRepoPath);
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('root-file.ts'), `Should include root-file.ts. Found: ${JSON.stringify(fileNames)}`);
      const expectedSubdirPath = path.join('subdir', 'sub-file.ts');
      assert.ok(fileNames.includes(expectedSubdirPath), `Should include ${expectedSubdirPath}. Found: ${JSON.stringify(fileNames)}`);
    });

    test('handles renamed files and excludes old filename', async () => {
      const { execSync } = require('child_process');

      const baseCommit = execSync('git rev-parse HEAD', { cwd: testRepoPath }).toString().trim();

      fs.writeFileSync(path.join(testRepoPath, 'old-name.ts'), 'export const value = 1;');
      execSync('git add old-name.ts', { cwd: testRepoPath });
      execSync('git commit -m "Add file to rename"', { cwd: testRepoPath });
      var fileNames = Array.from(await getCommittedChanges(testRepoPath, baseCommit, testRepoPath));


      fs.renameSync(path.join(testRepoPath, 'old-name.ts'), path.join(testRepoPath, 'new-name.ts'));
      execSync('git add -A', { cwd: testRepoPath });
      execSync('git commit -m "Rename file"', { cwd: testRepoPath });

      fileNames = Array.from(await getCommittedChanges(testRepoPath, baseCommit, testRepoPath));

      assert.ok(fileNames.includes('new-name.ts'), 'Should include new filename');
      assert.ok(!fileNames.includes('old-name.ts'), 'Should not include old filename');

      for (const fileName of fileNames) {
        const filePath = path.join(testRepoPath, fileName);
        assert.ok(fs.existsSync(filePath), `File should exist: ${fileName}`);
      }
    });
  });
});
