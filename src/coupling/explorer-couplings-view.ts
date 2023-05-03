/**
 * Shows couplings in the Explorer panel.
 *
 * The purpose of this view is to show the user which files are related to the one that is
 * currently active in the editor. The user can jump to these files by clicking on them.
 */
import * as vscode from 'vscode';
import { CouplingDataProvider } from './coupling-data-provider';
import { CoupledEntity } from './model';

export class ExplorerCouplingsView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: CouplingTreeProvider;

  constructor(couplingDataProvider: CouplingDataProvider) {
    this.treeDataProvider = new CouplingTreeProvider(couplingDataProvider);

    const view = vscode.window.createTreeView('codescene.explorerCouplingsView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
    });
    this.disposables.push(view);

    this.disposables.push(this.treeDataProvider.onDidChangeTreeData(() => {
      // Show the currently active file in the description
      const entityFilename = this.treeDataProvider.activeFileName;
      view.description = entityFilename;
    }));
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

export class CouplingTreeProvider implements vscode.TreeDataProvider<CoupledEntity> {
  private treeDataChangedEmitter = new vscode.EventEmitter<CoupledEntity | undefined | null | void>();

  constructor(private couplingDataProvider: CouplingDataProvider) {
    this.couplingDataProvider.onDidChangeData(() => this.treeDataChangedEmitter.fire());
    vscode.window.onDidChangeActiveTextEditor(() => this.treeDataChangedEmitter.fire());
  }

  get onDidChangeTreeData() {
    return this.treeDataChangedEmitter.event;
  }

  /**
   * Get the uri of the currently active file.
   */
  get activeFile(): vscode.Uri | undefined {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (!activeDocument || activeDocument.uri.scheme !== 'file') return undefined;

    return activeDocument.uri;
  }

  /**
   * Gets the filename part of the currently active file.
   *
   * Example: src/foo/bar.ts -> bar.ts
   */
  get activeFileName(): string | undefined {
    return this.activeFile?.path.split('/').pop();
  }

  getTreeItem(element: CoupledEntity): vscode.TreeItem {
    const item = new vscode.TreeItem(element.entityName);

    if (element.resourceUri) {
      item.resourceUri = element.resourceUri;
      item.label = undefined;
    }

    item.description = `${element.degree}%`;

    if (item.resourceUri) {
      item.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [item.resourceUri],
      };
    }

    const entityFilename = element.entityName.split('/').pop();
    const parentFilename = this.activeFileName;

    item.tooltip = new vscode.MarkdownString(
      `**${entityFilename}** is coupled to **${parentFilename}** with a coupling degree of \`${element.degree}%\``
    );

    return item;
  }

  async getChildren(element?: CoupledEntity): Promise<CoupledEntity[]> {
    if (element) {
      return [];
    } else {
      const couplings = await this.couplingDataProvider.getData();
      if (couplings === undefined || couplings.length === 0) return [];

      const activeAbsolutePath = this.activeFile?.fsPath;
      if (!activeAbsolutePath) return [];

      const couplingsFromActiveFile = couplings.filter((coupling) => activeAbsolutePath.endsWith(coupling.entity));

      return couplingsFromActiveFile.map((coupling) => {
        return {
          entityName: coupling.coupled,
          resourceUri: coupling.coupledUri,
          couplings: [],
          degree: coupling.degree
        };
      });
    }
  }
}
