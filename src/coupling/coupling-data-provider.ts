/**
 * Provides coupling information for the views that display couplings.
 *
 * For now, this is the couplings view in the Explorer panel and in the SCM panel.
 *
 * The data is cached and can be retrieved with the getData() method, or fetched again
 * with the fetch() method.
 */
import * as vscode from 'vscode';
import { Coupling, CsRestApi } from '../cs-rest-api';
import { CsWorkspace } from '../workspace';
import { Git } from '../git';
import { difference } from '../utils';
import { outputChannel } from '../log';

export interface CouplingWithUri extends Coupling {
  entityUri?: vscode.Uri;
  coupledUri?: vscode.Uri;
}

export class CouplingDataProvider {
  private dataChangedEmitter = new vscode.EventEmitter<void>();
  private cachedData: CouplingWithUri[] | undefined = undefined;
  private suppressError = false;

  constructor(private git: Git, private csRestApi: CsRestApi, private csWorkspace: CsWorkspace) {
    this.csWorkspace.onDidChangeProjectAssociation(() => this.fetch());
  }

  get onDidChangeData() {
    return this.dataChangedEmitter.event;
  }

  async getData() {
    if (this.cachedData === undefined) {
      await this.fetch({ silent: true });
    }
    return this.cachedData;
  }

  async fetch(opts = { silent: false }) {
    const projectId = this.csWorkspace.getProjectId();
    if (!projectId) {
      this.cachedData = undefined;
    } else {
      try {
        const couplings = await this.csRestApi.fetchCouplings(projectId);
        await this.validateRemoteRepoRoots(couplings);
        await this.processAndCacheData(couplings);
      } catch (e: any) {
        if (!this.suppressError) {
          const msg = e.message || 'Unknown error';
          vscode.window.showErrorMessage(`CodeScene failed to fetch couplings from server: ${msg}`);
          this.suppressError = true;
        }
      }
    }
    if (!opts.silent) {
      this.dataChangedEmitter.fire();
    }
  }

  /**
   * Check if there are remote repo roots that cannot be mapped to a local
   * workspace folder. The paths in analysis data in prefixed with the repository name,
   * and we need to know which workspace folder this corresponds to (if any!)
   *
   * Another complicating factor is that the workspace folders might
   * be sub folders of the repository root. For example, you might have opened
   * a single folder within a huge mono repo.
   */
  private async validateRemoteRepoRoots(data: Coupling[]) {
    // Remote repo roots are gathered from the first component of the coupling paths.
    const remoteRepoRoots = new Set(data.map((coupling) => coupling.entity.split('/')[0]));

    // Local repo roots are gathered from the git repos that contain the local workspace folders.
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const localRepoNames = workspaceFolders.map((folder) => this.git.repoRootNameFromDirectory(folder.uri.fsPath));
    const localRepoRoots = new Set(await Promise.all(localRepoNames));

    const unmappedLocalRepos = difference(localRepoRoots, remoteRepoRoots);
    const unmappedRemoteRepos = difference(remoteRepoRoots, localRepoRoots);

    if (unmappedLocalRepos.size > 0 && unmappedRemoteRepos.size > 0) {
      outputChannel.appendLine('Warning: The following local workspace folders are not mapped to a repository in the CodeScene project:');
      unmappedLocalRepos.forEach((workspace) => outputChannel.appendLine(`  ${workspace}`));
      outputChannel.appendLine('These are the unmapped repositories in the remote CodeScene project:');
      unmappedRemoteRepos.forEach((repository) => outputChannel.appendLine(`  ${repository}`));
      outputChannel.appendLine('Please make sure that the workspace folders and repositories names match.');
    }
  }

  private async processAndCacheData(couplings: Coupling[]) {
    // Couplings from the server are only unidirectional, but we want them to
    // be bidirectional in the UI. So we duplicate the couplings and swap the
    // entity and coupled fields.
    const swappedCouplings = couplings.map((coupling) => {
      return {
        ...coupling,
        entity: coupling.coupled,
        coupled: coupling.entity,
      };
    });
    const bidirectionalCouplings = couplings.concat(swappedCouplings);

    this.cachedData = await this.resolveAbsolutePaths(bidirectionalCouplings);
    this.cachedData.sort((a, b) => b.degree - a.degree);
  }

  private async resolveAbsolutePaths(couplings: Coupling[]) {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) return couplings;

    const repoRoots = new Map<string, string>();

    // Gather up the local repos so we might find where the coupled files are
    for (const folder of workspaceFolders) {
      const repoRoot = await this.git.repoRootFromDirectory(folder.uri.fsPath);
      if (repoRoot) {
        const repoRootName = repoRoot.split('/').pop();
        if (!repoRootName) continue;
        repoRoots.set(repoRootName, repoRoot);
      }
    }

    return couplings.map((coupling) => {
      const entityUri = this.resolveAbsolutePath(repoRoots, coupling.entity);
      const coupledUri = this.resolveAbsolutePath(repoRoots, coupling.coupled);
      return { ...coupling, entityUri, coupledUri };
    });
  }

  private resolveAbsolutePath(repoRoots: Map<string, string>, relativePath: string) {
    const couplingRepoRoot = relativePath.split('/')[0];
    const couplingPathWithoutRepoRoot = relativePath.split('/').slice(1).join('/');
    const repoRoot = repoRoots.get(couplingRepoRoot);
    if (!repoRoot) return undefined;
    return vscode.Uri.file(repoRoot + '/' + couplingPathWithoutRepoRoot);
  }
}
