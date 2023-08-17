/**
 * Shows couplings in the SCM view.
 *
 * The purpose of the view is to show couplings to files in the current change set, to
 * remind the user of other files that might need to be changed. Therefore, couplings might
 * not be shown if the coupled file is already in the change set.
 */
import * as vscode from 'vscode';
import { groupByProperty } from '../utils';
import { Git } from '../git';
import { CouplingDataProvider, CouplingWithUri } from './coupling-data-provider';
import { CoupledEntity } from './model';

export class ScmCouplingsView implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private treeDataProvider: CouplingTreeProvider;

  constructor(private git: Git, couplingDataProvider: CouplingDataProvider) {
    this.treeDataProvider = new CouplingTreeProvider(git, couplingDataProvider);

    const view = vscode.window.createTreeView('codescene.scmCouplingsView', {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
    });
    this.disposables.push(view);

    const openCmd = vscode.commands.registerCommand('codescene.scmCouplingsView.open', (item: CoupledEntity) => {
      vscode.commands.executeCommand('vscode.open', item.resourceUri);
    });
    this.disposables.push(openCmd);

    const refreshCmd = vscode.commands.registerCommand('codescene.scmCouplingsView.refresh', () => this.refresh());
    this.disposables.push(refreshCmd);

    // Refresh view on certain events
    this.disposables.push(
      this.git.onDidModifyChangeSet(() => {
        this.treeDataProvider.refresh();
      })
    );

    view.description = 'Other files that are often changed';
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  /**
   * Refetch the couplings from the server and refresh the tree view.
   */
  async refresh() {
    await this.treeDataProvider.refresh({ fetchFromServer: true });
  }
}

export class CouplingTreeProvider implements vscode.TreeDataProvider<CoupledEntity> {
  private treeDataChangedEmitter = new vscode.EventEmitter<CoupledEntity | undefined | null | void>();

  constructor(private git: Git, private couplingDataProvider: CouplingDataProvider) {
    this.couplingDataProvider.onDidChangeData(() => this.treeDataChangedEmitter.fire());
  }

  get onDidChangeTreeData() {
    return this.treeDataChangedEmitter.event;
  }

  getTreeItem(element: CoupledEntity): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.entityName,
      element.couplings?.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );

    if (element.resourceUri) {
      item.resourceUri = element.resourceUri;
      item.label = undefined;
    }

    // Leaf node
    if (element.couplings?.length === 0) {
      item.description = `${element.degree}%`;

      if (item.resourceUri) {
        item.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [item.resourceUri],
        };
      }

      const entityFilename = element.entityName.split('/').pop();
      const parentFilename = element.parent?.entityName.split('/').pop();

      item.tooltip = new vscode.MarkdownString(
        `**${entityFilename}** is coupled to **${parentFilename}** with a coupling degree of \`${element.degree}%\``
      );
    } else {
      item.contextValue = 'rootItem';
    }

    return item;
  }

  async getChildren(element?: CoupledEntity): Promise<CoupledEntity[]> {
    if (element) {
      return element.couplings;
    } else {
      // No need to bother with executing git etc if there are no couplings
      const couplings = await this.couplingDataProvider.getData();
      if (couplings === undefined || couplings.length === 0) return [];

      const changeSet = await this.git.changeSet();
      const couplingsInChangeSet = couplings.filter(
        // Because the purpose of the view is to show file you might have forgot to change
        // we remove those couplings where the coupled file is already in the change set.
        (coupling) => changeSet.has(coupling.entity) && !changeSet.has(coupling.coupled)
      );
      return buildTree(couplingsInChangeSet);
    }
  }

  async refresh(opts = { fetchFromServer: false }) {
    if (opts.fetchFromServer) {
      // This will indirectly cause treeDataChangedEmitter.fire() to be called
      await this.couplingDataProvider.fetch();
    } else {
      this.treeDataChangedEmitter.fire();
    }
  }
}

function buildTree(couplings: CouplingWithUri[]): CoupledEntity[] {
  const grouped = groupByProperty(couplings, 'entity');

  const entities = Object.keys(grouped).map((entityName) => {
    const couplings = grouped[entityName].map((coupling) => {
      const entity: CoupledEntity = {
        entityName: coupling.coupled,
        resourceUri: coupling.coupledUri,
        couplings: [],
        degree: coupling.degree,
      };
      return entity;
    });
    const resourceUri = grouped[entityName][0].entityUri;
    const entity: CoupledEntity = {
      entityName,
      resourceUri,
      couplings,
    };
    entity.couplings.forEach((coupling) => (coupling.parent = entity));
    return entity;
  });

  return entities;
}
