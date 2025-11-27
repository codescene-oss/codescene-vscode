/**
 * A workspace in vscode is the currently opened folder(s). You can also store settings in the workspace state.
 * We store for example the project id for the corresponding project on the CodeScene server (if one is associated).
 */
import * as vscode from 'vscode';

export class CsWorkspace {
  private projectAssociationChangedEmitter = new vscode.EventEmitter<number | undefined>();

  constructor(private context: vscode.ExtensionContext) {
    const projectId = this.getProjectId();
    this.updateIsWorkspaceAssociatedContext(projectId);
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
    void this.context.workspaceState.update('codescene.projectId', projectId);
    void vscode.commands.executeCommand('setContext', 'codescene.isWorkspaceAssociated', projectId !== undefined);
    this.projectAssociationChangedEmitter.fire(undefined);
  }

  clearProjectAssociation() {
    this.updateIsWorkspaceAssociatedContext(undefined);
  }

  dispose() {
    this.projectAssociationChangedEmitter.dispose();
  }
}
