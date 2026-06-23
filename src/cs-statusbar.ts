import vscode, { Disposable } from 'vscode';
import { AnalysisFeature, CsExtensionState } from './cs-extension-state';
import { isDefined } from './utils';

interface StatusBarOptions {
  text: string;
  tooltip?: string;
  command?: string;
  background?: string;
}

export class CsStatusBar implements Disposable {
  private disposables: Disposable[] = [];

  private readonly analysisStatus: vscode.StatusBarItem;

  constructor() {
    this.analysisStatus = this.createStatusBarItem(
      'codescene.analysisStatusBarItem',
      vscode.StatusBarAlignment.Left,
      0
    );
  }

  update() {
    const { analysis } = CsExtensionState.stateProperties.features;

    this.updateAnalysisStatus(analysis);
  }

  private updateAnalysisStatus(analysis: AnalysisFeature) {
    const item = this.analysisStatus;

    if (this.handleErrorStates(analysis)) return;

    switch (analysis.analysisState) {
      case 'running':
        this.setStatus(item, {
          text: '$(loading~spin) Analyzing...',
          tooltip: 'CodeScene analysis in progress...',
          command: 'codescene.showLogOutput',
        });
        return;
      case 'idle':
        this.setStatus(item, {
          text: '$(cs-logo) Analysis',
          tooltip: 'Code Health Analysis ready',
          command: 'codescene.homeView.focus',
        });
        return;
    }

    if (analysis.state === 'loading') {
      this.setStatus(item, {
        text: '$(loading~spin) Initializing...',
        tooltip: 'Analysis feature is initializing...',
        command: 'codescene.showLogOutput',
      });
    }
  }

  private handleErrorStates(analysis: AnalysisFeature) {
    if (analysis.state !== 'error' && !analysis.error) return false;

    this.setStatus(this.analysisStatus, {
      text: '$(cs-logo) Error',
      background: 'statusBarItem.errorBackground',
      tooltip: isDefined(analysis.error) ? 'Click to open output log and clear errors.' : 'Click to open output log',
      command: isDefined(analysis.error) ? 'codescene.extensionState.clearErrors' : 'codescene.showLogOutput',
    });

    return true;
  }

  private createStatusBarItem(id: string, align: vscode.StatusBarAlignment, priority: number) {
    const item = vscode.window.createStatusBarItem(id, align, priority);
    item.show();
    return item;
  }

  private setStatus(item: vscode.StatusBarItem, options: StatusBarOptions) {
    item.text = options.text;
    item.tooltip = options.tooltip;
    item.command = options.command;
    item.backgroundColor = options.background ? new vscode.ThemeColor(options.background) : undefined;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
