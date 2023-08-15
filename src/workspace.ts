/**
 * A workspace in vscode is the currently opened folder(s). You can also store settings in the workspace state.
 * We store for example the project id for the corresponding project on the CodeScene server (if one is associated).
 */
import * as vscode from 'vscode';
import { rankNamesBy } from './utils';
import { CsRestApi } from './cs-rest-api';
import { dirname } from 'path';
import { SimpleExecutor } from './executor';

export class CsWorkspace implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private projectAssociationChangedEmitter = new vscode.EventEmitter<number | undefined>();

  constructor(private context: vscode.ExtensionContext, private csRestApi: CsRestApi) {
    const associateCmd = vscode.commands.registerCommand('codescene.associateWithProject', async () => {
      await this.associateWithProject();
    });
    this.disposables.push(associateCmd);

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

  async associateWithProject() {
    const projects = await this.csRestApi.fetchProjects();

    const quickPickList = projects.map((p) => p.name);

    const workspaceName = vscode.workspace.name;
    if (workspaceName) {
      rankNamesBy(workspaceName, quickPickList);
    }

    const picked = await vscode.window.showQuickPick(quickPickList, {
      placeHolder: 'Select a project to associate with',
    });

    if (!picked) {
      return;
    }

    const project = projects.find((p) => p.name === picked);

    if (!project) {
      return;
    }

    // Store the project id in the workspace state (makes it retreivable via getProjectId())
    this.updateIsWorkspaceAssociatedContext(project.id);
  }

  /**
   * Updates the codescene.isWorkspaceAssociated context variable. This can be used in package.json to conditionally enable/disable views.
   */
  private updateIsWorkspaceAssociatedContext(projectId: number | undefined) {
    this.context.workspaceState.update('codescene.projectId', projectId);
    vscode.commands.executeCommand('setContext', 'codescene.isWorkspaceAssociated', projectId !== undefined);
    this.projectAssociationChangedEmitter.fire(undefined);
  }

  clearProjectAssociation() {
    this.updateIsWorkspaceAssociatedContext(undefined);
  }

  /**
   * Updates the codescene.isLoggedIn context variable. This can be used in package.json to conditionally enable/disable views.
   */
  updateIsLoggedInContext(loggedIn: boolean) {
    vscode.commands.executeCommand('setContext', 'codescene.isLoggedIn', loggedIn);
  }

  /**
   * Updates the codescene.remoteFeaturesEnabled context variable. This can be used in package.json to conditionally enable/disable views.
   */
  updateRemoteFeatureEnabledContext(enable: boolean) {
    vscode.commands.executeCommand('setContext', 'codescene.remoteFeaturesEnabled', enable);
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
