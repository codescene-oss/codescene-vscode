import vscode from 'vscode';
import { AnalysisFeature, CsExtensionState, CsFeature } from './cs-extension-state';
import { CreditsInfoError } from './devtools-api';
import { isDefined, toUppercase } from './utils';

interface StatusBarOptions {
  text: string;
  tooltip?: string;
  command?: string;
  background?: string;
}

export class CsStatusBar {
  private readonly aceStatus: vscode.StatusBarItem;
  private readonly analysisStatus: vscode.StatusBarItem;

  constructor() {
    this.aceStatus = this.createStatusBarItem('codescene.aceStatusBarItem', vscode.StatusBarAlignment.Left, -1);
    this.analysisStatus = this.createStatusBarItem(
      'codescene.analysisStatusBarItem',
      vscode.StatusBarAlignment.Left,
      0
    );
  }

  update() {    
    const { analysis, ace } = CsExtensionState.stateProperties.features;

    this.updateAceStatus(ace);
    this.updateAnalysisStatus(analysis);
  }

  private updateAceStatus(ace: CsFeature) {
    const item = this.aceStatus;

    switch (ace.state) {
      case 'error':
        if (this.reportableAceError(ace.error)) {
          this.setStatus(item, {
            text: `$(error) ACE ${toUppercase(ace.state)}`,
            tooltip: 'Retry ACE activation',
            command: 'codescene.ace.setEnabled',
            background: 'statusBarItem.errorBackground',
          });
      
          break;
        }
      case 'offline':
      case 'disabled':
        this.setStatus(item, {
          text: `$(error) ACE ${toUppercase(ace.state)}`,
          tooltip: ace.state === 'disabled' ? 'Enable ACE in the extension settings' : 'Retry ACE activation',
          command: 'codescene.ace.setEnabled',
          background: 'statusBarItem.warningBackground',
        });

        break;
      case 'loading':
        this.setStatus(item, {
          text: '$(loading~spin) ACE',
          tooltip: 'Retrying ACE activation...',
        });
        break;
      default:
        this.setStatus(item, {
          text: '$(cs-logo) ACE',
          tooltip: 'CodeScene ACE is active',
        });
        break;
    }
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

  /**
   * Don't show errors related to credit outages
   */
  private reportableAceError(error?: Error) {
    return isDefined(error) && !(error instanceof CreditsInfoError);
  }
}
