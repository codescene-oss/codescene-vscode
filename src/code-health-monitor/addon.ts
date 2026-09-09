import vscode, { Uri } from 'vscode';
import { API, Repository } from '../../types/git';
import { register as registerCodeLens } from './codelens';
import { register as registerHomeView } from './home/home-view';
import { acquireGitApi } from '../git-utils';
import { CsExtensionState } from '../cs-extension-state';
import { InteractiveDocsParams } from '../documentation/commands';
import { CodeSceneCWFDocsTabPanel } from '../codescene-tab/webview/documentation/cwf-webview-docs-panel';
import { BackgroundServiceView } from './background-view';

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

  const codeHealthMonitorHelpCommand = vscode.commands.registerCommand('codescene.codeHealthMonitorHelp', () => {
    const params: InteractiveDocsParams = {
      issueInfo: { category: 'docs_code_health_monitor', position: new vscode.Position(0, 0) },
      document: undefined,
    };
    CodeSceneCWFDocsTabPanel.show(params);
  });

  ALL_DISPOSABLES = [clearTreeEmitter, codeHealthMonitorView, codeHealthMonitorHelpCommand];

  context.subscriptions.push(...ALL_DISPOSABLES);
}

export function getRepo(fileUri: Uri): Repository | null {
  if (!gitApi || !CsExtensionState.hasInstance) return null;

  return gitApi!.getRepository(fileUri);
}

export function deactivate() {
  ALL_DISPOSABLES.forEach((disposable) => disposable.dispose());
  ALL_DISPOSABLES = [];
  gitApi = undefined;
}

export function setGitApiForTesting(api: API | undefined): void {
  gitApi = api;
}
