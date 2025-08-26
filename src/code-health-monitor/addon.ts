import vscode, { Uri } from 'vscode';
import { API, Repository } from '../../types/git';
import Reviewer from '../review/reviewer';
// CS-5069 Remove ACE from public version
// import { register as registerCodeLens } from './codelens';
import { register as registerCodeHealthDetailsView } from './details/view';
import { CodeHealthMonitorView } from './tree-view';
import {
  acquireGitApi,
  getBranchCreationCommit,
  getLatestCommits,
  isMainBranch,
  resetBaselineForFilesChanged,
  repoState,
  updateGitState,
} from '../git-utils';
import { Baseline, CsExtensionState } from '../cs-extension-state';

let gitApi: API | undefined;

const clearTreeEmitter = new vscode.EventEmitter<void>();
export const onTreeDataCleared = clearTreeEmitter.event;

export function activate(context: vscode.ExtensionContext) {
  gitApi = acquireGitApi();
  if (!gitApi) return;

  const codeHealthMonitorView = new CodeHealthMonitorView(context);
  // CS-5069 Remove ACE from public version
  // registerCodeLens(context);
  registerCodeHealthDetailsView(context);

  const repoStateListeners = gitApi.repositories.map((repo) => repo.state.onDidChange(() => onRepoStateChange(repo)));

  CsExtensionState.onBaselineChanged(() => {
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

const baselineHandlers: Record<Baseline, (repo: Repository) => Promise<string>> = {
  [Baseline.head]: getHeadCommit,
  [Baseline.default]: getDefaultCommit,
  [Baseline.branchCreation]: getBranchCreationCommit,
};

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
  if (!gitApi || !CsExtensionState.baseline) return;

  const repo = gitApi!.getRepository(fileUri);
  if (!repo) return '';

  const handler = baselineHandlers[CsExtensionState.baseline];
  return await handler(repo);
}

/**
 * Retrieves the commit point for the HEAD of the current repository for a given file.
 *
 * If no suitable commit is found, it defaults to comparing against a perfect score (10.0).
 */
async function getHeadCommit(repo: Repository) {
  const head = repo.state.HEAD?.commit;
  return head || '';
}

/**
 * Determines the default comparison point for a file based on the current Git branch context.
 *
 * Default behavior:
 * - If on the main branch, the comparison point is the HEAD commit.
 * - If on a non-main branch, the comparison point is the branch creation commit.
 * - If the branch cannot be determined, fallback logic compares to a perfect score.
 */
async function getDefaultCommit(repo: Repository) {
  const isMain = isMainBranch(repo.state.HEAD?.name);

  if (isMain) {
    return await getHeadCommit(repo);
  } else {
    return await getBranchCreationCommit(repo);
  }
}

const commitHandlers: Record<Baseline, (repo: Repository) => Promise<void>> = {
  [Baseline.head]: handleHeadRepoStateChange,
  [Baseline.default]: handleDefaultRepoStateChange,
  [Baseline.branchCreation]: handleBranchCreationRepoStateChange,
};

/**
 * Reacts to changes in the repository's HEAD commit by:
 * - skipping logic if the commit hasn't changed,
 * - deleting review cache & monitor tree entries if branch was changed, otherwise
 * - triggering baseline-specific handling logic.
 */
async function onRepoStateChange(repo: Repository) {
  updateGitState(repo);
  const hasCheckedOut = repoState?.branch && repoState?.branch !== repo.state.HEAD!.name;

  if (hasCheckedOut) {
    Reviewer.instance.clearCache();
    clearTreeEmitter.fire();
  } else {
    const handler = commitHandlers[CsExtensionState.baseline];
    await handler(repo);
  }
}

/**
 * Handles baseline changes when the baseline is set to branch creation.
 */
async function handleBranchCreationRepoStateChange(repo: Repository) {
  const first = await getBranchCreationCommit(repo);
  const second = repo.state.HEAD?.commit;

  const isMain = isMainBranch(repo.state.HEAD?.name);

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
  const isMain = isMainBranch(repo.state.HEAD?.name);
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
  const head = { ...repo.state.HEAD };
  if (!head) return;

  const commits = await getLatestCommits(repo);
  const [headRef, prevRef] = commits;

  if (commits.length !== 2 || head.commit !== headRef) {
    void Reviewer.instance.refreshAllDeltasAndBaselines();
    return;
  }

  void resetBaselineForFilesChanged({ prevRef, headRef, repo });
}
