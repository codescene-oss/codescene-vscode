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
import { getWorkspaceFolder } from '../utils';

let gitApi: API | undefined;

const clearTreeEmitter = new vscode.EventEmitter<void>();
export const onTreeDataCleared = clearTreeEmitter.event;

let ALL_DISPOSABLES: vscode.Disposable[] = [];

export function activate(context: vscode.ExtensionContext) {
  gitApi = acquireGitApi();
  if (!gitApi) return;

  const codeHealthMonitorView = new BackgroundServiceView(context);
  registerHomeView(context, codeHealthMonitorView);

  registerCodeLens(context);

  for (const repo of gitApi.repositories) {
    void onRepoStateChange(repo);
  }

  const repoStateListeners = gitApi.repositories
    .filter((repo) => repo?.state)
    .map((repo) => repo.state.onDidChange(() => void onRepoStateChange(repo)));

  const baselineChangedListener = CsExtensionState.onBaselineChanged(refreshMergeBaseBaselines);

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

export async function getMergeBaseCommitForWorkspace(): Promise<string | undefined> {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) return;
  const repo = getRepo(workspaceFolder.uri);
  if (!repo) return;
  return await getMergeBaseCommit(repo);
}

async function onRepoStateChange(repo: Repository) {
  const gitStateChange = updateGitState(repo);

  if (gitStateChange.branchChanged || gitStateChange.commitChanged) {
    await setBaseline(repo);
  }
}

async function setBaseline(repo: Repository) {
  const repoPath = getRepoRootPath(repo);
  const baselineCommit = await getMergeBaseCommit(repo);
  Reviewer.instance.setBaseline((fileUri: Uri) => {
    const r = getRepo(fileUri);
    return r ? getRepoRootPath(r) === repoPath : false;
  }, baselineCommit);
}

export async function refreshMergeBaseBaselines(): Promise<void> {
  if (!gitApi) {
    return;
  }
  for (const repo of gitApi.repositories) {
    await setBaseline(repo);
  }
}

export function deactivate() {
  ALL_DISPOSABLES.forEach((disposable) => disposable.dispose());
  ALL_DISPOSABLES = [];
  gitApi = undefined;
}

export function setGitApiForTesting(api: API | undefined): void {
  gitApi = api;
}
