/**
 * A workspace in vscode is the currently opened folder(s). You can also store settings in the workspace state.
 * We store for example the project id for the corresponding project on the CodeScene server (if one is associated).
 *
 * We also use this as a container for lightweight state management, such as sign in and feature availability.
 */
import { dirname } from 'path';
import * as vscode from 'vscode';
import { CsRestApi, PreFlightResponse } from './cs-rest-api';
import { CliStatus } from './download';
import { SimpleExecutor } from './executor';
import { rankNamesBy } from './utils';
import Telemetry from './telemetry';

export interface CsFeatures {
  codeHealthAnalysis?: CliStatus;
  automatedCodeEngineering?: PreFlightResponse;
}

export interface CsExtensionState {
  session?: vscode.AuthenticationSession;
  features?: CsFeatures;
}

export class CsWorkspace implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private projectAssociationChangedEmitter = new vscode.EventEmitter<number | undefined>();

  private extensionStateChangedEmitter = new vscode.EventEmitter<CsExtensionState>();
  readonly onDidExtensionStateChange = this.extensionStateChangedEmitter.event;

  extensionState: CsExtensionState = {};

  constructor(private context: vscode.ExtensionContext) {
    const projectId = this.getProjectId();
    this.updateIsWorkspaceAssociatedContext(projectId);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  /**
   * Emitted when the user associates their vs code workspace with a project on the CodeScene server.
   */
  get onDidChangeProjectAssociation() {
    return this.projectAssociationChangedEmitter.event;
  }

  getProjectId(): number | undefined {
    return this.context.workspaceState.get('codescene.projectId');
  }

  /**
   * Updates the codescene.isWorkspaceAssociated context variable. This can be used in package.json to conditionally enable/disable views.
   */
  updateIsWorkspaceAssociatedContext(projectId: number | undefined) {
    this.context.workspaceState.update('codescene.projectId', projectId);
    vscode.commands.executeCommand('setContext', 'codescene.isWorkspaceAssociated', projectId !== undefined);
    this.projectAssociationChangedEmitter.fire(undefined);
  }

  clearProjectAssociation() {
    this.updateIsWorkspaceAssociatedContext(undefined);
  }

  /**
   * Sets session state and updates the codescene.isSignedIn context variable.
   * This can be used in package.json to conditionally enable/disable views.
   */
  setSession(session: vscode.AuthenticationSession) {
    vscode.commands.executeCommand('setContext', 'codescene.isSignedIn', true);
    Telemetry.instance.setSession(session);
    this.extensionState.session = session;
    this.extensionStateChangedEmitter.fire(this.extensionState);
  }

  /**
   * Unsets session state and updates the codescene.isSignedIn context variable.
   * Also updates feature availability state (ACE) and fires an event to notify listeners.
   * (ACE cannot be available when signed out)
   */
  unsetSession() {
    vscode.commands.executeCommand('setContext', 'codescene.isSignedIn', false);
    Telemetry.instance.setSession();
    delete this.extensionState['session'];
    delete this.extensionState.features?.automatedCodeEngineering;
    this.extensionStateChangedEmitter.fire(this.extensionState);
  }

  setCliStatus(cliStatus: CliStatus) {
    this.extensionState.features = { ...this.extensionState.features, codeHealthAnalysis: cliStatus };
    this.extensionStateChangedEmitter.fire(this.extensionState);
  }

  setACEEnabled(preflight: PreFlightResponse | undefined) {
    this.extensionState.features = { ...this.extensionState.features, automatedCodeEngineering: preflight };
    this.extensionStateChangedEmitter.fire(this.extensionState);
  }

  /**
   * Project path here means the path used by the codescene server to denote the file.
   *
   * This is a relative file path with the repo name as the root. E.g. codescene-vscode/src/extension.ts.
   */
  async getCsFilePath(absoluteFilePath: vscode.Uri) {
    const fileDir = dirname(absoluteFilePath.fsPath);
    const executor = new SimpleExecutor();

    const repoRoot = await executor.execute(
      { command: 'git', args: ['rev-parse', '--show-toplevel'] },
      { cwd: fileDir }
    );

    if (repoRoot.exitCode !== 0) {
      return;
    }

    const repoRelativePath = await executor.execute(
      { command: 'git', args: ['ls-files', '--full-name', '--', absoluteFilePath.fsPath] },
      { cwd: fileDir }
    );

    if (repoRelativePath.exitCode !== 0) {
      return;
    }

    const repoRootName = repoRoot.stdout.trim().split('/').pop();
    const relativePath = repoRelativePath.stdout.trim();

    return `${repoRootName}/${relativePath}`;
  }
}
