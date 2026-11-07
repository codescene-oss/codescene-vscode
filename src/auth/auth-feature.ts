import vscode from 'vscode';
import { CsExtensionState } from '../cs-extension-state';
import { DevtoolsAPI } from '../devtools-api';
import { acquireGitApi, getRepoRootPath } from '../git-utils';
import { logOutputChannel } from '../log';
import type { ObjectivesFeature } from '../objectives/objectives-feature';
import Telemetry from '../telemetry';
import { registerAuthCommands, SIGN_IN_COMMAND, SIGN_IN_CONTEXT_KEY } from './auth-commands';
import { registerAuthMessages } from './auth-message-handler';
import { AuthNotices } from './auth-notices';
import { toAuthFlow, toAuthPayload, type AuthSnapshot } from './auth-payload';
import { pickRepo } from './auth-repo';
import { AuthService } from './auth-service';
import { VsCodeAuthSettings } from './auth-settings';
import type { AuthTransport } from './auth-transport';
import { setCwfAuth } from './cwf-auth';
import { isLicensed, LicenseGate, type LicenseHooks } from './license-gate';

const HOME_VIEW_FOCUS_COMMAND = 'codescene.homeView.focus';

function openInBrowser(url: string): Thenable<boolean> {
  return vscode.env.openExternal(vscode.Uri.parse(url, true));
}

function openSetting(id: string): Thenable<unknown> {
  return vscode.commands.executeCommand('workbench.action.openSettings', id);
}

function publish(snapshot: AuthSnapshot, notices: AuthNotices): void {
  CsExtensionState.setAuth({ active: snapshot.active, status: snapshot.status });
  setCwfAuth(toAuthPayload(snapshot), toAuthFlow(snapshot), snapshot.surface, isLicensed(snapshot));
  void vscode.commands.executeCommand('setContext', SIGN_IN_CONTEXT_KEY, snapshot.active);
  void notices.update(snapshot);
}

export function revealOnAuthRequest(service: Pick<AuthService, 'onDidRequestAuth'>): vscode.Disposable {
  return service.onDidRequestAuth(() => void vscode.commands.executeCommand(HOME_VIEW_FOCUS_COMMAND));
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

export function activateAuth(
  context: vscode.ExtensionContext,
  transport: AuthTransport,
  license: LicenseHooks,
  objectives?: ObjectivesFeature
): vscode.Disposable[] {
  const settings = new VsCodeAuthSettings();
  const service = new AuthService({
    transport,
    settings,
    openExternal: openInBrowser,
    logUsage: (name, data) => Telemetry.logUsage(name, data),
  });
  const notices = new AuthNotices({
    show: (message, ...items) => vscode.window.showInformationMessage(message, ...items),
    signIn: () => vscode.commands.executeCommand(SIGN_IN_COMMAND),
    focusHomeView: () => vscode.commands.executeCommand(HOME_VIEW_FOCUS_COMMAND),
    logUsage: (name, data) => Telemetry.logUsage(name, data),
  });
  const licenseGate = new LicenseGate(license);
  DevtoolsAPI.useLicenseGate(licenseGate);
  const disposables: vscode.Disposable[] = [
    settings,
    service,
    service.onDidChange((snapshot) => {
      publish(snapshot, notices);
      licenseGate.update(snapshot);
      objectives?.update(snapshot);
    }),
    revealOnAuthRequest(service),
    registerAuthMessages(service, {
      openServerSetting: () => openSetting('codescene.serverUrl'),
      openExternal: openInBrowser,
    }),
    ...registerAuthCommands(service),
    ...watchRepository(service),
  ];
  void service.start().catch((error: unknown) => logOutputChannel.warn(`[auth] start failed: ${String(error)}`));
  return disposables;
}
