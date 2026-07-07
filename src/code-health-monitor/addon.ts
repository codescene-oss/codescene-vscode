import vscode, { Uri } from 'vscode';
import { API, Repository } from '../../types/git';
import Reviewer from '../review/reviewer';
import { register as registerCodeLens } from './codelens';
import { register as registerHomeView } from './home/home-view';
import { acquireGitApi, getMergeBaseCommit, getRepoRootPath, updateGitState } from '../git-utils';
import { CsExtensionState } from '../cs-extension-state';
import { InteractiveDocsParams } from '../documentation/commands';
import { CodeSceneCWFDocsTabPanel } from '../codescene-tab/webview/documentation/cwf-webview-docs-panel';
import { BackgroundServiceView } from './background-view';
import { GitChangeLister } from '../git/git-change-lister';
import { DevtoolsAPI } from '../devtools-api';
import { DroppingScheduledExecutor } from '../dropping-scheduled-executor';
import { logOutputChannel } from '../log';
import { SimpleExecutor } from '../simple-executor';
import { isGitAvailable } from '../git/git-detection';
import { SavedFilesTracker } from '../saved-files-tracker';
import { isVSCodeWindowFocused } from '../extension-impl';

const GIT_CHANGE_LISTER_BASE_PERIOD_SECONDS = 9;

let gitApi: API | undefined;
let gitChangeListerInstance: GitChangeLister | undefined;
let scheduledExecutorInstance: DroppingScheduledExecutor | undefined;

const clearTreeEmitter = new vscode.EventEmitter<void>();
export const onTreeDataCleared = clearTreeEmitter.event;

let ALL_DISPOSABLES: vscode.Disposable[] = [];

export async function runScheduledGitChangeReview(): Promise<void> {
  if (!isVSCodeWindowFocused()) {
    logOutputChannel.debug('Skipping scheduled git change review: window not focused');
    return;
  }
  if (!isGitAvailable()) return;
  if (DevtoolsAPI.isAnalysisRunning) {
    logOutputChannel.info('Skipping scheduled git change review: analysis in progress');
    return;
  }
  logOutputChannel.info('Starting scheduled git change review');

  const startTime = Date.now();
  await gitChangeListerInstance!.start();
  const elapsedMs = Date.now() - startTime;
  const elapsedSeconds = Math.ceil(elapsedMs / 1000);

  logOutputChannel.debug(`Scheduled git change review completed in ${elapsedSeconds}s`);

  if (elapsedSeconds > GIT_CHANGE_LISTER_BASE_PERIOD_SECONDS && scheduledExecutorInstance) {
    const newPeriod = GIT_CHANGE_LISTER_BASE_PERIOD_SECONDS * 2 + elapsedSeconds;
    const currentPeriod = scheduledExecutorInstance.getIntervalSeconds();
    if (newPeriod > currentPeriod) {
      scheduledExecutorInstance.setInterval(newPeriod);
      logOutputChannel.info(`Git change review took ${elapsedSeconds}s, increased period to ${newPeriod}s`);
    }
  }
}

export function activate(context: vscode.ExtensionContext, savedFilesTracker: SavedFilesTracker) {
  if (!savedFilesTracker) {
    throw new Error('SavedFilesTracker must be provided to activate Code Health Monitor');
  }

  gitApi = acquireGitApi();
  if (!gitApi) return;

  const codeHealthMonitorView = new BackgroundServiceView(context);
  registerHomeView(context, codeHealthMonitorView);

  registerCodeLens(context);

  // Ensure an initial baseline is set
  for (const repo of gitApi.repositories) {
    void onRepoStateChange(repo);
  }

  const repoStateListeners = gitApi.repositories
    .filter((repo) => repo?.state)
    .map((repo) => repo.state.onDidChange(() => void onRepoStateChange(repo)));

  const baselineChangedListener = CsExtensionState.onBaselineChanged(refreshMergeBaseBaselines);

  // Review all changed/added files periodically.
  // NOTE: while this spawns Git processes that often, it does not trigger CLI processed that often,
  // because `CsDiagnostics.review` has built-in caching.
  gitChangeListerInstance = new GitChangeLister(DevtoolsAPI.concurrencyLimitingExecutor, savedFilesTracker);
  scheduledExecutorInstance = new DroppingScheduledExecutor(new SimpleExecutor(), GIT_CHANGE_LISTER_BASE_PERIOD_SECONDS);

  void scheduledExecutorInstance.executeTask(runScheduledGitChangeReview);

  const codeHealthMonitorHelpCommand = vscode.commands.registerCommand('codescene.codeHealthMonitorHelp', () => {
    const params: InteractiveDocsParams = {
      issueInfo: { category: 'docs_code_health_monitor', position: new vscode.Position(0, 0) },
      document: undefined,
    };
    CodeSceneCWFDocsTabPanel.show(params);
  });

  ALL_DISPOSABLES = [
    clearTreeEmitter,
    codeHealthMonitorView,
    scheduledExecutorInstance,
    baselineChangedListener,
    codeHealthMonitorHelpCommand,
    ...repoStateListeners,
  ];

  context.subscriptions.push(...ALL_DISPOSABLES);
}

export function getRepo(fileUri: Uri): Repository | null {
  if (!gitApi || !CsExtensionState.hasInstance) return null;

  return gitApi!.getRepository(fileUri);
}

export async function getBaselineCommit(fileUri: Uri): Promise<string | undefined> {
  const repo = getRepo(fileUri);
  if (!repo) return;
  return await getMergeBaseCommit(repo);
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
  const repoPath = getRepoRootPath(repo);
  Reviewer.instance.setBaseline((fileUri: Uri) => {
    const r = getRepo(fileUri);
    return r ? getRepoRootPath(r) === repoPath : false;
  });
}

/** Refreshes review baselines for all open repositories after main-branch detection changes. */
export function refreshMergeBaseBaselines(): void {
  if (!gitApi) {
    return;
  }
  for (const repo of gitApi.repositories) {
    setBaseline(repo);
  }
}

/** Re-scans git changes vs merge-base (e.g. after .codescene/config.json edit). */
export async function runGitChangeLister(): Promise<void> {
  if (!gitChangeListerInstance || !isGitAvailable()) {
    return;
  }
  await gitChangeListerInstance.start();
}

export function deactivate() {
  ALL_DISPOSABLES.forEach((disposable) => disposable.dispose());
  ALL_DISPOSABLES = [];
  gitChangeListerInstance = undefined;
  scheduledExecutorInstance = undefined;
  gitApi = undefined;
}

export function getScheduledExecutorForTesting(): DroppingScheduledExecutor | undefined {
  return scheduledExecutorInstance;
}
