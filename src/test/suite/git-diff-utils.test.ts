import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { getStatusChanges, getCommittedChanges, parseGitStatusFilename, createWorkspacePrefix, isFileInWorkspace, MAX_UNTRACKED_FILES_PER_LOCATION } from '../../git/git-diff-utils';

suite('Git Diff Utils Test Suite', () => {
  const testRepoPath = path.join(__dirname, '../../../test-git-repo-diff-utils');

  setup(async () => {
    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
    fs.mkdirSync(testRepoPath, { recursive: true });

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
      const workspaceDir = path.join(testRepoPath, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, 'file.ts'), 'export const x = 1;');

      const { normalizedWorkspacePath, workspacePrefix } = createWorkspacePrefix(workspaceDir);
      const filePath = 'workspace/file.ts';
      const result = isFileInWorkspace(filePath, testRepoPath, normalizedWorkspacePath, workspacePrefix);
      assert.ok(result, `Expected file to be in workspace. filePath: ${filePath}, repoPath: ${testRepoPath}, normalizedWorkspacePath: ${normalizedWorkspacePath}, workspacePrefix: ${workspacePrefix}`);
    });

    test('returns false for file outside workspace', () => {
      const workspaceDir = path.join(testRepoPath, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });

      const otherDir = path.join(testRepoPath, 'other');
      fs.mkdirSync(otherDir, { recursive: true });
      fs.writeFileSync(path.join(otherDir, 'file.ts'), 'export const y = 1;');

      const { normalizedWorkspacePath, workspacePrefix } = createWorkspacePrefix(workspaceDir);
      const filePath = 'other/file.ts';
      const result = isFileInWorkspace(filePath, testRepoPath, normalizedWorkspacePath, workspacePrefix);
      assert.ok(!result, `Expected file to be outside workspace. filePath: ${filePath}, repoPath: ${testRepoPath}, normalizedWorkspacePath: ${normalizedWorkspacePath}, workspacePrefix: ${workspacePrefix}`);
    });

    test('returns false for file with similar prefix', () => {
      const workspaceDir = path.join(testRepoPath, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });

      const similarDir = path.join(testRepoPath, 'workspace-other');
      fs.mkdirSync(similarDir, { recursive: true });
      fs.writeFileSync(path.join(similarDir, 'file.ts'), 'export const z = 1;');

      const { normalizedWorkspacePath, workspacePrefix } = createWorkspacePrefix(workspaceDir);
      const filePath = 'workspace-other/file.ts';
      const result = isFileInWorkspace(filePath, testRepoPath, normalizedWorkspacePath, workspacePrefix);
      assert.ok(!result, `Expected file to be outside workspace. filePath: ${filePath}, repoPath: ${testRepoPath}, normalizedWorkspacePath: ${normalizedWorkspacePath}, workspacePrefix: ${workspacePrefix}`);
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

      const changes = await getStatusChanges(testRepoPath, testRepoPath, new Set<string>());
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

      const changes = await getStatusChanges(testRepoPath, testRepoPath, new Set<string>());
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
      let changes = await getStatusChanges(testRepoPath, testRepoPath, new Set<string>());
      assert.strictEqual(changes.size, 0, 'Should return empty set for clean repo');

      fs.unlinkSync(path.join(testRepoPath, 'existing.ts'));
      changes = await getStatusChanges(testRepoPath, testRepoPath, new Set<string>());
      const fileNames = Array.from(changes);
      assert.ok(!fileNames.includes('existing.ts'), 'Should not include deleted file');
    });

    test('filters files outside workspacePath when gitRootPath differs', async () => {
      const subDir = path.join(testRepoPath, 'workspace-subdir');
      fs.mkdirSync(subDir, { recursive: true });

      fs.writeFileSync(path.join(subDir, 'inside.ts'), 'export const inside = 1;');

      fs.writeFileSync(path.join(testRepoPath, 'outside.ts'), 'export const outside = 1;');

      const changes = await getStatusChanges(testRepoPath, subDir, new Set<string>());
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
      const changes = await getStatusChanges(testRepoPath, workspacePathWithSlash, new Set<string>());
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('file.ts'), 'Should handle workspacePath with trailing slash and strip prefix');
    });

    test('filters and strips prefix for files with same name in different locations', async () => {
      const uiDir = path.join(testRepoPath, 'ui');
      fs.mkdirSync(uiDir, { recursive: true });

      fs.writeFileSync(path.join(testRepoPath, 'gc.cpp'), '// bad gc.cpp at root');

      fs.writeFileSync(path.join(uiDir, 'gc.cpp'), '// good gc.cpp in ui');

      const changes = await getStatusChanges(testRepoPath, uiDir, new Set<string>());
      const fileNames = Array.from(changes);

      assert.strictEqual(fileNames.length, 1, 'Should only include one gc.cpp file');
      assert.ok(fileNames.includes('gc.cpp'), 'Should include gc.cpp from ui directory with prefix stripped');

      const returnedFilePath = path.join(uiDir, fileNames[0]);
      const content = fs.readFileSync(returnedFilePath, 'utf8');
      assert.ok(content.includes('good gc.cpp in ui'), 'Should return the gc.cpp from ui directory with good content');
      assert.ok(!content.includes('bad gc.cpp at root'), 'Should not return the gc.cpp from root with bad content');
    });

    test('handles renamed files and excludes old filename', async () => {
      fs.writeFileSync(path.join(testRepoPath, 'file-to-rename.ts'), 'export const value = 1;');
      execSync('git add file-to-rename.ts', { cwd: testRepoPath });
      execSync('git commit -m "Add file to rename"', { cwd: testRepoPath });

      fs.renameSync(path.join(testRepoPath, 'file-to-rename.ts'), path.join(testRepoPath, 'file-renamed.ts'));
      execSync('git add -A', { cwd: testRepoPath });

      const changes = await getStatusChanges(testRepoPath, testRepoPath, new Set<string>());
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('file-renamed.ts'), 'Should include new filename');
      assert.ok(!fileNames.includes('file-to-rename.ts'), 'Should not include old filename');

      for (const fileName of fileNames) {
        const filePath = path.join(testRepoPath, fileName);
        assert.ok(fs.existsSync(filePath), `File should exist: ${fileName}`);
      }
    });

    test('excludes untracked files when more than MAX_UNTRACKED_FILES_PER_LOCATION at root level', async () => {
      const count = MAX_UNTRACKED_FILES_PER_LOCATION + 1;
      for (let i = 1; i <= count; i++) {
        fs.writeFileSync(path.join(testRepoPath, `untracked${i}.ts`), `export const x${i} = 1;`);
      }

      const changes = await getStatusChanges(testRepoPath, testRepoPath, new Set<string>());
      const fileNames = Array.from(changes);

      for (let i = 1; i <= count; i++) {
        assert.ok(!fileNames.includes(`untracked${i}.ts`), `Should not include untracked${i}.ts`);
      }
    });

    test('includes untracked files when MAX_UNTRACKED_FILES_PER_LOCATION or fewer at root level', async () => {
      const count = MAX_UNTRACKED_FILES_PER_LOCATION;
      for (let i = 1; i <= count; i++) {
        fs.writeFileSync(path.join(testRepoPath, `untracked${i}.ts`), `export const x${i} = 1;`);
      }

      const changes = await getStatusChanges(testRepoPath, testRepoPath, new Set<string>());
      const fileNames = Array.from(changes);

      for (let i = 1; i <= count; i++) {
        assert.ok(fileNames.includes(`untracked${i}.ts`), `Should include untracked${i}.ts`);
      }
    });

    test('excludes untracked files in directory when more than MAX_UNTRACKED_FILES_PER_LOCATION in that directory', async () => {
      const untrackedDir = path.join(testRepoPath, 'untracked-dir');
      fs.mkdirSync(untrackedDir, { recursive: true });

      const count = MAX_UNTRACKED_FILES_PER_LOCATION + 1;
      for (let i = 1; i <= count; i++) {
        fs.writeFileSync(path.join(untrackedDir, `file${i}.ts`), `export const x${i} = 1;`);
      }

      const changes = await getStatusChanges(testRepoPath, testRepoPath, new Set<string>());
      const fileNames = Array.from(changes);

      for (let i = 1; i <= count; i++) {
        assert.ok(!fileNames.includes(path.join('untracked-dir', `file${i}.ts`)), `Should not include untracked-dir/file${i}.ts`);
      }
    });

    test('includes untracked files in directory when MAX_UNTRACKED_FILES_PER_LOCATION or fewer in that directory', async () => {
      const untrackedDir = path.join(testRepoPath, 'untracked-dir');
      fs.mkdirSync(untrackedDir, { recursive: true });

      const count = MAX_UNTRACKED_FILES_PER_LOCATION;
      for (let i = 1; i <= count; i++) {
        fs.writeFileSync(path.join(untrackedDir, `file${i}.ts`), `export const x${i} = 1;`);
      }

      const changes = await getStatusChanges(testRepoPath, testRepoPath, new Set<string>());
      const fileNames = Array.from(changes);

      for (let i = 1; i <= count; i++) {
        const expectedPath = path.join('untracked-dir', `file${i}.ts`);
        assert.ok(fileNames.includes(expectedPath), `Should include ${expectedPath}`);
      }
    });

    test('handles multiple directories with different untracked file counts', async () => {
      const dir1 = path.join(testRepoPath, 'many-files');
      fs.mkdirSync(dir1, { recursive: true });
      const manyCount = MAX_UNTRACKED_FILES_PER_LOCATION + 1;
      for (let i = 1; i <= manyCount; i++) {
        fs.writeFileSync(path.join(dir1, `file${i}.ts`), `export const x${i} = 1;`);
      }

      const dir2 = path.join(testRepoPath, 'few-files');
      fs.mkdirSync(dir2, { recursive: true });
      const fewCount = MAX_UNTRACKED_FILES_PER_LOCATION - 2;
      for (let i = 1; i <= fewCount; i++) {
        fs.writeFileSync(path.join(dir2, `file${i}.ts`), `export const y${i} = 1;`);
      }

      const changes = await getStatusChanges(testRepoPath, testRepoPath, new Set<string>());
      const fileNames = Array.from(changes);

      for (let i = 1; i <= manyCount; i++) {
        assert.ok(!fileNames.includes(path.join('many-files', `file${i}.ts`)), `Should not include many-files/file${i}.ts`);
      }

      for (let i = 1; i <= fewCount; i++) {
        const expectedPath = path.join('few-files', `file${i}.ts`);
        assert.ok(fileNames.includes(expectedPath), `Should include ${expectedPath}`);
      }
    });

    test('always includes tracked modified files regardless of count', async () => {
      const count = MAX_UNTRACKED_FILES_PER_LOCATION * 2;
      for (let i = 1; i <= count; i++) {
        fs.writeFileSync(path.join(testRepoPath, `tracked${i}.ts`), `export const x${i} = 1;`);
      }
      execSync('git add .', { cwd: testRepoPath });
      execSync('git commit -m "Add tracked files"', { cwd: testRepoPath });

      for (let i = 1; i <= count; i++) {
        fs.writeFileSync(path.join(testRepoPath, `tracked${i}.ts`), `export const x${i} = 2;`);
      }

      const changes = await getStatusChanges(testRepoPath, testRepoPath, new Set<string>());
      const fileNames = Array.from(changes);

      for (let i = 1; i <= count; i++) {
        assert.ok(fileNames.includes(`tracked${i}.ts`), `Should include tracked${i}.ts`);
      }
    });

    test('includes untracked files that are in filesToExcludeFromHeuristic even when exceeding MAX_UNTRACKED_FILES_PER_LOCATION', async () => {
      const count = MAX_UNTRACKED_FILES_PER_LOCATION + 3;
      for (let i = 1; i <= count; i++) {
        fs.writeFileSync(path.join(testRepoPath, `untracked${i}.ts`), `export const x${i} = 1;`);
      }

      const file2Path = path.join(testRepoPath, 'untracked2.ts');
      const file5Path = path.join(testRepoPath, 'untracked5.ts');
      const filesToExcludeFromHeuristic = new Set<string>([file2Path, file5Path]);

      const changes = await getStatusChanges(testRepoPath, testRepoPath, filesToExcludeFromHeuristic);
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('untracked2.ts'), 'Should include untracked2.ts (in filesToExcludeFromHeuristic)');
      assert.ok(fileNames.includes('untracked5.ts'), 'Should include untracked5.ts (in filesToExcludeFromHeuristic)');

      for (let i = 1; i <= count; i++) {
        if (i !== 2 && i !== 5) {
          assert.ok(!fileNames.includes(`untracked${i}.ts`), `Should not include untracked${i}.ts (not in filesToExcludeFromHeuristic)`);
        }
      }
    });

    test('includes untracked files in directory that are in filesToExcludeFromHeuristic even when exceeding MAX_UNTRACKED_FILES_PER_LOCATION', async () => {
      const untrackedDir = path.join(testRepoPath, 'untracked-dir');
      fs.mkdirSync(untrackedDir, { recursive: true });

      const count = MAX_UNTRACKED_FILES_PER_LOCATION + 3;
      for (let i = 1; i <= count; i++) {
        fs.writeFileSync(path.join(untrackedDir, `file${i}.ts`), `export const x${i} = 1;`);
      }

      const file1Path = path.join(untrackedDir, 'file1.ts');
      const file4Path = path.join(untrackedDir, 'file4.ts');
      const filesToExcludeFromHeuristic = new Set<string>([file1Path, file4Path]);

      const changes = await getStatusChanges(testRepoPath, testRepoPath, filesToExcludeFromHeuristic);
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('untracked-dir/file1.ts') || fileNames.includes('untracked-dir\\file1.ts'), 'Should include file1.ts (in filesToExcludeFromHeuristic)');
      assert.ok(fileNames.includes('untracked-dir/file4.ts') || fileNames.includes('untracked-dir\\file4.ts'), 'Should include file4.ts (in filesToExcludeFromHeuristic)');

      for (let i = 1; i <= count; i++) {
        if (i !== 1 && i !== 4) {
          const found = fileNames.some(name => name.includes(`file${i}.ts`));
          assert.ok(!found, `Should not include file${i}.ts (not in filesToExcludeFromHeuristic)`);
        }
      }
    });

    test('includes mix of tracked modified files and untracked files from filesToExcludeFromHeuristic', async () => {
      fs.writeFileSync(path.join(testRepoPath, 'tracked.ts'), 'export const tracked = 1;');
      execSync('git add tracked.ts', { cwd: testRepoPath });
      execSync('git commit -m "Add tracked file"', { cwd: testRepoPath });

      fs.writeFileSync(path.join(testRepoPath, 'tracked.ts'), 'export const tracked = 2;');

      const count = MAX_UNTRACKED_FILES_PER_LOCATION + 2;
      for (let i = 1; i <= count; i++) {
        fs.writeFileSync(path.join(testRepoPath, `untracked${i}.ts`), `export const x${i} = 1;`);
      }

      const file3Path = path.join(testRepoPath, 'untracked3.ts');
      const filesToExcludeFromHeuristic = new Set<string>([file3Path]);

      const changes = await getStatusChanges(testRepoPath, testRepoPath, filesToExcludeFromHeuristic);
      const fileNames = Array.from(changes);

      assert.ok(fileNames.includes('tracked.ts'), 'Should include tracked modified file');
      assert.ok(fileNames.includes('untracked3.ts'), 'Should include untracked3.ts (in filesToExcludeFromHeuristic)');

      for (let i = 1; i <= count; i++) {
        if (i !== 3) {
          assert.ok(!fileNames.includes(`untracked${i}.ts`), `Should not include untracked${i}.ts`);
        }
      }
    });
  });

  suite('getCommittedChanges', () => {
    test('filters committed files outside workspacePath when gitRootPath differs', async () => {
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
