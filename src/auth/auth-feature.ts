import vscode from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { acquireGitApi, getRepoRootPath } from '../git-utils';
import { logOutputChannel } from '../log';
import Telemetry from '../telemetry';
import { registerAuthCommands, SIGN_IN_COMMAND, SIGN_IN_CONTEXT_KEY } from './auth-commands';
import { registerAuthMessages, routeAuthMessage } from './auth-message-handler';
import { AuthNotices } from './auth-notices';
import { AuthPanel } from './auth-panel';
import { toAuthPayload, type AuthSnapshot } from './auth-payload';
import { pickRepo } from './auth-repo';
import { AuthService } from './auth-service';
import { VsCodeAuthSettings } from './auth-settings';
import type { AuthTransport } from './auth-transport';
import { setCwfAuth } from './cwf-auth';

function openInBrowser(url: string): Thenable<boolean> {
  return vscode.env.openExternal(vscode.Uri.parse(url, true));
}

function openSetting(id: string): Thenable<unknown> {
  return vscode.commands.executeCommand('workbench.action.openSettings', id);
}

function showAuthView(): void {
  AuthPanel.show(routeAuthMessage);
}

function publish(snapshot: AuthSnapshot, notices: AuthNotices): void {
  CsExtensionState.setAuth({ active: snapshot.active, status: snapshot.status });
  setCwfAuth(toAuthPayload(snapshot));
  void vscode.commands.executeCommand('setContext', SIGN_IN_CONTEXT_KEY, snapshot.active);
  void notices.update(snapshot);
}

function watchRepository(service: AuthService): vscode.Disposable[] {
  const git = acquireGitApi();
  const update = () =>
    void service.setRepo(
      pickRepo(git?.repositories.map(getRepoRootPath) ?? [], vscode.window.activeTextEditor?.document.uri.fsPath)
    );
  update();
  return [
    vscode.window.onDidChangeActiveTextEditor(update),
    ...(git ? [git.onDidOpenRepository(update), git.onDidCloseRepository(update)] : []),
  ];
}

export function activateAuth(context: vscode.ExtensionContext, transport: AuthTransport): vscode.Disposable[] {
  const settings = new VsCodeAuthSettings();
  const service = new AuthService({
    transport,
    settings,
    openExternal: openInBrowser,
    logUsage: (name, data) => Telemetry.logUsage(name, data),
  });
  const notices = new AuthNotices(context.globalState, {
    show: (message, ...items) => vscode.window.showInformationMessage(message, ...items),
    signIn: () => vscode.commands.executeCommand(SIGN_IN_COMMAND),
  });
  const disposables: vscode.Disposable[] = [
    settings,
    service,
    service.onDidChange((snapshot) => publish(snapshot, notices)),
    registerAuthMessages(service, {
      showAuthView,
      openServerSetting: () => openSetting('codescene.serverUrl'),
      openExternal: openInBrowser,
    }),
    ...registerAuthCommands(service, showAuthView),
    ...watchRepository(service),
  ];
  void service.start().catch((error: unknown) => logOutputChannel.warn(`[auth] start failed: ${String(error)}`));
  return disposables;
}
