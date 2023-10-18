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
        const localRepoRoots = await this.localRepoRoots();
        const repoNameAgnostic = await this.validateRepoRoots(couplings, localRepoRoots);
        await this.processAndCacheData(couplings, localRepoRoots, repoNameAgnostic);
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
   * Local repo roots are gathered from the git repos that contain the local workspace folders.
   * @returns 
   */
  private async localRepoRoots() {
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const repoRoots = new Map<string, string>();

    for (const folder of workspaceFolders) {
      const repoRoot = await this.git.repoRootFromDirectory(folder.uri.fsPath);
      if (repoRoot) {
        const repoRootName = repoRoot.split('/').pop();
        if (!repoRootName) continue;
        repoRoots.set(repoRootName, repoRoot);
      }
    }
    return repoRoots;
  }

  /**
   * Check if there are remote repo roots that cannot be mapped to a local
   * workspace folder. The paths in analysis data in prefixed with the repository name,
   * and we need to know which workspace folder this corresponds to (if any!)
   *
   * Another complicating factor is that the workspace folders might
   * be sub folders of the repository root. For example, you might have opened
   * a single folder within a huge mono repo.
   * 
   * In the special case there's a one-to-one mapping of remote repositories in the 
   * CodeScene project to one local repo in the workspace this function returns true. 
   * This indicates that we can match the change coupling paths without requiring that
   * the workspace folder(s) matches the repository path(s).
   */
  private async validateRepoRoots(couplings: Coupling[], localRepoRoots: Map<string, string>) {
    // Remote repo roots are gathered from the first component of the coupling entity paths.
    const remoteRepoRootNames = new Set(couplings
      .map(({ entity }) => this.splitCouplingPath(entity))
      .map(({ root }) => root));
    const localRepoRootNames = new Set(localRepoRoots.keys());

    const unmappedLocalRepos = difference(localRepoRootNames, remoteRepoRootNames);
    const unmappedRemoteRepos = difference(remoteRepoRootNames, localRepoRootNames);

    if (remoteRepoRootNames.size === 1 && localRepoRootNames.size === 1) {
      // When there's exactly one of both local and remote repo roots, we can assume it's intentional,
      // even if the root names don't match. Will go down the simple path resolution code-path.
      outputChannel.appendLine(`Info: Change Coupling assuming one-to-one mapping of remote CodeScene repo "
      ${Array.from(remoteRepoRootNames)[0]}" and local git root "${Array.from(localRepoRootNames)[0]}".`);
      return true;
    }

    if (unmappedLocalRepos.size > 0 && unmappedRemoteRepos.size > 0) {
      outputChannel.appendLine('Warning: The following local workspace folders are not mapped to a repository in the CodeScene project:');
      unmappedLocalRepos.forEach((workspace) => outputChannel.appendLine(`  ${workspace}`));
      outputChannel.appendLine('These are the unmapped repositories in the remote CodeScene project:');
      unmappedRemoteRepos.forEach((repository) => outputChannel.appendLine(`  ${repository}`));
      outputChannel.appendLine('Please make sure that the workspace folders and repositories names match.');
    }
    return false;
  }

  private async processAndCacheData(couplings: Coupling[], localRepoRoots: Map<string, string>, repoNameAgnostic: boolean) {
    const bidirectionalCouplings = this.createBidirectionalCouplings(couplings);
    if (repoNameAgnostic) {
      const repoNameAgnosticCouplings = bidirectionalCouplings.map((coupling) => {
        const { path: entityPath } = this.splitCouplingPath(coupling.entity);
        const { path: coupledPath } = this.splitCouplingPath(coupling.coupled);
        return {
          ...coupling,
          entity: entityPath,
          coupled: coupledPath,
        };
      });
      this.cachedData = await this.resolveAbsolutePathsSimple(repoNameAgnosticCouplings, localRepoRoots);
    } else {
      this.cachedData = await this.resolveAbsolutePaths(bidirectionalCouplings, localRepoRoots);
    }
    this.cachedData.sort((a, b) => b.degree - a.degree);
  }

  /**
   * Couplings from the server are only unidirectional, but we want them to
   * be bidirectional in the UI. So we duplicate the couplings and swap the
   * entity and coupled fields.
   * @param couplings    
   * @returns 
   */
  private createBidirectionalCouplings(couplings: Coupling[]) {
    const swappedCouplings = couplings.map((coupling) => {
      return {
        ...coupling,
        entity: coupling.coupled,
        coupled: coupling.entity,
      };
    });
    return couplings.concat(swappedCouplings);
  }

  private async resolveAbsolutePathsSimple(couplings: Coupling[], localRepoRoots: Map<string, string>) {
    if (localRepoRoots.size === 0) return couplings;
    const singleRepoRoot = Array.from(localRepoRoots.values())[0];

    return couplings.map((coupling) => {
      const entityUri = vscode.Uri.file(singleRepoRoot + '/' + coupling.entity);
      const coupledUri = vscode.Uri.file(singleRepoRoot + '/' + coupling.coupled);
      return { ...coupling, entityUri, coupledUri };
    });
  }

  private async resolveAbsolutePaths(couplings: Coupling[], localRepoRoots: Map<string, string>) {
    if (localRepoRoots.size === 0) { return couplings; }

    return couplings.map((coupling) => {
      const entityUri = this.resolveAbsolutePath(localRepoRoots, coupling.entity);
      const coupledUri = this.resolveAbsolutePath(localRepoRoots, coupling.coupled);
      return { ...coupling, entityUri, coupledUri };
    });
  }

  private resolveAbsolutePath(localRepoRoots: Map<string, string>, couplingPath: string) {
    const { root, path } = this.splitCouplingPath(couplingPath);
    const repoRoot = localRepoRoots.get(root);
    if (!repoRoot) return undefined;
    return vscode.Uri.file(repoRoot + '/' + path);
  }

  private splitCouplingPath(couplingPath: string) {
    return {
      root: couplingPath.split('/')[0],
      path: couplingPath.split('/').slice(1).join('/')
    };
  }
}

