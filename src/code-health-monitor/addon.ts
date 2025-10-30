import vscode, { Uri } from 'vscode';
import * as path from 'path';
import { API, Repository, Change } from '../../types/git';
import Reviewer from '../review/reviewer';
import { register as registerCodeLens } from './codelens';
import { register as registerHomeView } from './home/home-view';
import { acquireGitApi, getBranchCreationCommit, isMainBranch, updateGitState } from '../git-utils';
import { Baseline, CsExtensionState } from '../cs-extension-state';
import { InteractiveDocsParams } from '../documentation/commands';
import { CodeSceneCWFDocsTabPanel } from '../codescene-tab/webview/documentation/cwf-webview-docs-panel';
import { BackgroundServiceView } from './background-view';
import CsDiagnostics from '../diagnostics/cs-diagnostics';
import { supportedExtensions } from '../language-support';
import { logOutputChannel } from '../log';
import { GitChangeLister } from '../git/git-change-lister';
import { DevtoolsAPI } from '../devtools-api';

let gitApi: API | undefined;

const clearTreeEmitter = new vscode.EventEmitter<void>();
export const onTreeDataCleared = clearTreeEmitter.event;

export function activate(context: vscode.ExtensionContext) {
  gitApi = acquireGitApi();
  if (!gitApi) return;

  const codeHealthMonitorView = new BackgroundServiceView(context);
  registerHomeView(context, codeHealthMonitorView);

  registerCodeLens(context);

  // Ensure an initial baseline is set
  for (const repo of gitApi.repositories) {
    void onRepoStateChange(repo);
  }

  const repoStateListeners = gitApi.repositories.map((repo) => repo.state.onDidChange(() => void onRepoStateChange(repo)));

  CsExtensionState.onBaselineChanged(async () => {
    for (const repo of gitApi!.repositories) {
      await setBaseline(repo);
    }
  });

  // Review all changed/added files once when repository state is ready
  const gitChangeLister = new GitChangeLister(gitApi, DevtoolsAPI.concurrencyLimitingExecutor);
  gitChangeLister.setupInitialReview(context);

  context.subscriptions.push(
    codeHealthMonitorView,
    ...repoStateListeners,
    vscode.commands.registerCommand('codescene.codeHealthMonitorHelp', () => {
      const params: InteractiveDocsParams = {
        issueInfo: { category: 'docs_code_health_monitor', position: new vscode.Position(0, 0) },
        document: undefined,
      };
      CodeSceneCWFDocsTabPanel.show(params);
    })
  );
}

const baselineHandlers: Record<Baseline, (repo: Repository) => Promise<string>> = {
  [Baseline.head]: getHeadCommit,
  [Baseline.default]: getDefaultCommit,
  [Baseline.branchCreation]: getBranchCreationCommit,
};

export function getRepo(fileUri: Uri): Repository | null {
  if (!gitApi || !CsExtensionState.baseline) return null;

  return gitApi!.getRepository(fileUri);
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
  const repo = getRepo(fileUri);
  if (!repo) return;

  const handler = baselineHandlers[Baseline.default]; //CS-5597: was baselineHandlers[CsExtensionState.baseline]
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

/**
 * Reacts to changes in the repository's HEAD commit or branch by
 * setting the baseline if either of them changed
 */
function onRepoStateChange(repo: Repository) {
  const gitStateChange = updateGitState(repo);

  if (gitStateChange.branchChanged || gitStateChange.commitChanged) {
    setBaseline(repo);
  }
}

function setBaseline(repo: Repository) {
  Reviewer.instance.setBaseline((fileUri: Uri) => {
    const r = getRepo(fileUri);
    return r?.rootUri.path === repo.rootUri.path;
  });
}
