import * as vscode from 'vscode';

import { CsWorkspace } from './workspace';
import { getServerUrl } from './configuration';
import { CoupledEntity } from './coupling/model';

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

        const csFilePath = await this.codeSceneWorkspace.getCsFilePath(uri);
        if (!csFilePath) return;

        this.openCodeReview(csFilePath);
      }),
      vscode.commands.registerCommand('codescene.openXRay', async (file: vscode.Uri | CoupledEntity) => {
        let uri = file instanceof vscode.Uri ? file : file.resourceUri;
        if (!uri) return;

        const csFilePath = await this.codeSceneWorkspace.getCsFilePath(uri);
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
      vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
    });
  }

  openHotspots() {
    this.withProjectId((projectId) => {
      const hotspotsUrl = `${getServerUrl()}/projects/${projectId}/jobs/latest-successful/results/code/hotspots/system-map`;
      vscode.env.openExternal(vscode.Uri.parse(hotspotsUrl));
    });
  }

  openChangeCoupling() {
    this.withProjectId((projectId) => {
      const changeCouplingUrl = `${getServerUrl()}/projects/${projectId}/jobs/latest-successful/results/code/temporal-coupling/by-commits`;
      vscode.env.openExternal(vscode.Uri.parse(changeCouplingUrl));
    });
  }

  openCodeReview(filePathInRepo: string) {
    this.withProjectId((projectId) => {
      const codeReviewUrl = `${getServerUrl()}/projects/${projectId}/jobs/latest-successful/results/code/hotspots/biomarkers?name=${filePathInRepo}`;
      vscode.env.openExternal(vscode.Uri.parse(codeReviewUrl));
    });
  }

  openXRay(filePathInRepo: string) {
    this.withProjectId((projectId) => {
      const xrayUrl = `${getServerUrl()}/projects/${projectId}/jobs/latest-successful/results/files/hotspots?file-name=${filePathInRepo}`;
      vscode.env.openExternal(vscode.Uri.parse(xrayUrl));
    });
  }
}
