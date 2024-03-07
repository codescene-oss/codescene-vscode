import * as vscode from 'vscode';

import { dirname } from 'path';
import { getServerUrl } from './configuration';
import { CoupledEntity } from './coupling/model';
import { CsWorkspace } from './workspace';
import { SimpleExecutor } from './executor';

/**
 * Registers commands for opening CodeScene links in the browser.
 */
export class Links implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private codeSceneWorkspace: CsWorkspace) {
    this.disposables.push(
      vscode.commands.registerCommand('codescene.openDashboard', () => {
        this.openDashboard();
      }),
      vscode.commands.registerCommand('codescene.openHotspots', () => {
        this.openHotspots();
      }),
      vscode.commands.registerCommand('codescene.openChangeCoupling', () => {
        this.openChangeCoupling();
      }),
      vscode.commands.registerCommand('codescene.openCodeReview', async (file: vscode.Uri | CoupledEntity) => {
        let uri = file instanceof vscode.Uri ? file : file.resourceUri;
        if (!uri) return;

        const csFilePath = await getCsFilePath(uri);
        if (!csFilePath) return;

        this.openCodeReview(csFilePath);
      }),
      vscode.commands.registerCommand('codescene.openXRay', async (file: vscode.Uri | CoupledEntity) => {
        let uri = file instanceof vscode.Uri ? file : file.resourceUri;
        if (!uri) return;

        const csFilePath = await getCsFilePath(uri);
        if (!csFilePath) return;

        this.openXRay(csFilePath);
      })
    );
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  private withProjectId(callback: (projectId: number) => void) {
    const projectId = this.codeSceneWorkspace.getProjectId();

    if (!projectId) {
      return;
    }

    callback(projectId);
  }

  openDashboard() {
    this.withProjectId((projectId) => {
      const dashboardUrl = `${getServerUrl()}/projects/${projectId}`;
      void vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
    });
  }

  openHotspots() {
    this.withProjectId((projectId) => {
      const hotspotsUrl = `${getServerUrl()}/projects/${projectId}/jobs/latest-successful/results/code/hotspots/system-map`;
      void vscode.env.openExternal(vscode.Uri.parse(hotspotsUrl));
    });
  }

  openChangeCoupling() {
    this.withProjectId((projectId) => {
      const changeCouplingUrl = `${getServerUrl()}/projects/${projectId}/jobs/latest-successful/results/code/temporal-coupling/by-commits`;
      void vscode.env.openExternal(vscode.Uri.parse(changeCouplingUrl));
    });
  }

  openCodeReview(filePathInRepo: string) {
    this.withProjectId((projectId) => {
      const codeReviewUrl = `${getServerUrl()}/projects/${projectId}/jobs/latest-successful/results/code/hotspots/biomarkers?name=${filePathInRepo}`;
      void vscode.env.openExternal(vscode.Uri.parse(codeReviewUrl));
    });
  }

  openXRay(filePathInRepo: string) {
    this.withProjectId((projectId) => {
      const xrayUrl = `${getServerUrl()}/projects/${projectId}/jobs/latest-successful/results/files/hotspots?file-name=${filePathInRepo}`;
      void vscode.env.openExternal(vscode.Uri.parse(xrayUrl));
    });
  }
}

/**
   * Project path here means the path used by the codescene server to denote the file.
   *
   * This is a relative file path with the repo name as the root. E.g. codescene-vscode/src/extension.ts.
   */
async function getCsFilePath(absoluteFilePath: vscode.Uri) {
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
