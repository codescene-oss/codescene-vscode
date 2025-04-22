import vscode, { Uri } from 'vscode';
import { API, Repository } from '../../types/git';
import Reviewer from '../review/reviewer';
import { register as registerCodeLens } from './codelens';
import { register as registerCodeHealthDetailsView } from './details/view';
import { Baseline, CodeHealthMonitorView } from './tree-view';
import {
  acquireGitApi,
  getBranchCreationCommit,
  getLatestCommits,
  isMainBranch,
  removeStaleFiles,
  resetBaselineForFilesChanged,
} from '../git-utils';

let gitApi: API | undefined;
let lastCommit: string | undefined;
let currentBaseline: string | undefined;

export function activate(context: vscode.ExtensionContext) {
  gitApi = acquireGitApi();
  if (!gitApi) return;

  currentBaseline = context.globalState.get('baseline');

  const codeHealthMonitorView = new CodeHealthMonitorView(context);
  registerCodeLens(context);
  registerCodeHealthDetailsView(context);

  const repoStateListeners = gitApi.repositories.map((repo) => repo.state.onDidChange(() => onRepoStateChange(repo)));

  codeHealthMonitorView.onBaselineChanged(() => {
    currentBaseline = context.globalState.get('baseline');
    Reviewer.instance.refreshAllDeltasAndBaselines();
  });

  context.subscriptions.push(
    codeHealthMonitorView,
    ...repoStateListeners,
    vscode.commands.registerCommand('codescene.codeHealthMonitorHelp', () => {
      void vscode.commands.executeCommand(
        'markdown.showPreviewToSide',
        vscode.Uri.parse(`csdoc:code-health-monitor.md`)
      );
    })
  );
}

/**
 * Determines the appropriate baseline commit for a given file according to the active baseline strategy.
 *
 * This commit serves as the reference point for calculating delta results in a baseline review.
 * If no suitable commit is found, the comparison defaults to a perfect score (10.0).
 *
 * The strategy options are:
 * - Head: compares with the most recent commit (HEAD).
 * - Default: compares with the HEAD commit if on the default branch; otherwise, compares with the branch creation point.
 * - BranchCreation: compares with the commit where the current branch was created.
 */
export async function getBaselineCommit(fileUri: Uri): Promise<string | undefined> {
  if (!gitApi) return;

  const repo = gitApi!.getRepository(fileUri);
  if (!repo) return '';

  switch (currentBaseline) {
    case Baseline.Head:
      return await getHeadPoint(repo);
    case Baseline.Default:
      return await getDefaultPoint(repo);
    case Baseline.BranchCreation:
      return await getBranchCreationCommit(repo);
  }
}

/**
 * Retrieves the commit point for the HEAD of the current repository for a given file.
 *
 * If no suitable commit is found, it defaults to comparing against a perfect score (10.0).
 */
async function getHeadPoint(repo: Repository) {
  const commits = await getLatestCommits(repo);
  const head = repo.state.HEAD;

  if (commits.length !== 2 || !head) {
    return '';
  }

  return 'HEAD';
}

/**
 * Determines the default comparison point for a file based on the current Git branch context.
 *
 * Default behavior:
 * - If on the main branch, the comparison point is the HEAD commit.
 * - If on a non-main branch, the comparison point is the branch creation commit.
 * - If the branch cannot be determined, fallback logic compares to a perfect score.
 */
async function getDefaultPoint(repo: Repository) {
  const isMain = await isMainBranch({ currentBranch: repo.state.HEAD?.name, repoPath: repo.rootUri.path });

  if (isMain) {
    return await getHeadPoint(repo);
  } else {
    return await getBranchCreationCommit(repo);
  }
}

/**
 * Reacts to changes in the repository's HEAD commit by:
 * - Skipping logic if the commit hasn't changed,
 * - Removing monitor entries for files no longer in the current branch,
 * - Triggering baseline-specific handling logic.
 */
async function onRepoStateChange(repo: Repository) {
  const hasRepoChanged = lastCommit !== repo.state.HEAD?.commit;
  if (!hasRepoChanged) {
    return;
  }
  lastCommit = repo.state.HEAD?.commit;

  await removeStaleFiles(repo, currentBaseline);
  void handleBaselineChange(repo);
}

async function handleBaselineChange(repo: Repository) {
  switch (currentBaseline) {
    case Baseline.Head:
      return handleHeadRepoStateChange(repo);
    case Baseline.Default:
      return handleDefaultRepoStateChange(repo);
    case Baseline.BranchCreation:
      return handleBranchCreationRepoStateChange(repo);
  }
}

/**
 * Handles baseline changes when the baseline is set to branch creation.
 */
async function handleBranchCreationRepoStateChange(repo: Repository) {
  const first = await getBranchCreationCommit(repo);
  const second = repo.state.HEAD?.commit;

  const isMain = await isMainBranch({ currentBranch: repo.state.HEAD?.name, repoPath: repo.rootUri.path });

  if (isMain) {
    Reviewer.instance.refreshAllDeltasAndBaselines();
    return;
  }

  const shouldDiff = first && second && first !== second;
  if (!shouldDiff) return;

  const changes = await repo.diffBetween(first, second);
  changes.forEach((change) => {
    Reviewer.instance.reviewCache.resetBaseline(change.uri.fsPath);
  });
}

/**
 * Handles baseline changes when the baseline is set to default.
 */
async function handleDefaultRepoStateChange(repo: Repository) {
  const isMain = await isMainBranch({ currentBranch: repo.state.HEAD?.name, repoPath: repo.rootUri.path });
  if (isMain) {
    void handleHeadRepoStateChange(repo);
  } else {
    void handleBranchCreationRepoStateChange(repo);
  }
}

/**
 * Handles baseline changes when the baseline is set to HEAD.
 */
async function handleHeadRepoStateChange(repo: Repository) {
  if (!repo.state.HEAD) return;
  const head = { ...repo.state.HEAD };

  const commits = await getLatestCommits(repo);
  const [headRef, prevRef] = commits;

  if (commits.length !== 2 || head.commit !== headRef) {
    void Reviewer.instance.refreshAllDeltasAndBaselines();
    return;
  }

  void resetBaselineForFilesChanged({ prevRef, headRef, repo });
}
