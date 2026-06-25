import * as fs from 'fs';
import * as path from 'path';
import { GitChangeLister } from '../../git/git-change-lister';
import { MockExecutor } from '../mocks/mock-executor';
import { restoreDefaultWorkspaceFolders } from '../setup';
import { resetWorkspaceFileActivity } from '../../git/workspace-activity';

export const GIT_CHANGE_LISTER_TEST_REPO = path.join(__dirname, '../../../test-git-repo');

export interface GitChangeListerFixture {
  gitChangeLister: GitChangeLister;
  mockExecutor: MockExecutor;
}

export async function setupGitChangeListerFixture(): Promise<GitChangeListerFixture> {
  if (fs.existsSync(GIT_CHANGE_LISTER_TEST_REPO)) {
    fs.rmSync(GIT_CHANGE_LISTER_TEST_REPO, { recursive: true, force: true });
  }
  fs.mkdirSync(GIT_CHANGE_LISTER_TEST_REPO, { recursive: true });

  const { execSync } = require('child_process');
  execSync('git init', { cwd: GIT_CHANGE_LISTER_TEST_REPO });
  execSync('git config user.email "test@example.com"', { cwd: GIT_CHANGE_LISTER_TEST_REPO });
  execSync('git config user.name "Test User"', { cwd: GIT_CHANGE_LISTER_TEST_REPO });
  execSync('git config advice.defaultBranchName false', { cwd: GIT_CHANGE_LISTER_TEST_REPO });

  fs.writeFileSync(path.join(GIT_CHANGE_LISTER_TEST_REPO, 'README.md'), '# Test Repository');
  execSync('git add README.md', { cwd: GIT_CHANGE_LISTER_TEST_REPO });
  execSync('git commit -m "Initial commit"', { cwd: GIT_CHANGE_LISTER_TEST_REPO });

  const mockExecutor = new MockExecutor();
  const mockSavedFilesTracker = { getSavedFiles: () => new Set<string>() } as any;
  const gitChangeLister = new GitChangeLister(mockExecutor, mockSavedFilesTracker);

  return { gitChangeLister, mockExecutor };
}

export function teardownGitChangeListerFixture(): void {
  restoreDefaultWorkspaceFolders();
  resetWorkspaceFileActivity();
  if (fs.existsSync(GIT_CHANGE_LISTER_TEST_REPO)) {
    try {
      fs.rmSync(GIT_CHANGE_LISTER_TEST_REPO, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (error: any) {
      if (error?.code !== 'EBUSY' && error?.code !== 'ENOTEMPTY') {
        throw error;
      }
    }
  }
}
