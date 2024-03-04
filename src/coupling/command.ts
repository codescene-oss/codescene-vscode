import vscode from 'vscode';
import { CsRestApi } from '../cs-rest-api';
import { rankNamesBy } from '../utils';
import { CsWorkspace } from '../workspace';

export function registerCommand(context: vscode.ExtensionContext, csRestApi: CsRestApi, csWorkspace: CsWorkspace) {
  const associateCmd = vscode.commands.registerCommand('codescene.associateWithProject', async () => {
    const projects = await csRestApi.fetchProjects();

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
    csWorkspace.updateIsWorkspaceAssociatedContext(project.id);
  });
  context.subscriptions.push(associateCmd);
}