import vscode from 'vscode';
import { CsExtensionState, CsStateProperties } from './cs-extension-state';
import { CreditsInfoError } from './devtools-api';
import { isDefined } from './utils';

export class CsStatusBar {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(initialState: CsStateProperties) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      'codescene.statusBarItem',
      vscode.StatusBarAlignment.Right,
      -1
    );
    this.setState(initialState);
    this.statusBarItem.show();
  }

  update() {
    this.setState(CsExtensionState.stateProperties);
    this.indicateErrors(CsExtensionState.stateProperties);
  }

  private setState(stateProperties: CsStateProperties) {
    this.statusBarItem.name = 'CodeScene status bar';
    this.statusBarItem.text = this.textContent(stateProperties);
    this.statusBarItem.tooltip = this.tooltipContent(stateProperties);
    this.statusBarItem.command = 'codescene.homeView.focus';
    this.statusBarItem.backgroundColor = undefined;
  }

  private isOnline(stateProperties: CsStateProperties) {
    return isDefined(stateProperties.session);
  }

  private isAnalysing(stateProperties: CsStateProperties) {
    return stateProperties.features.analysis.analysisState === 'running';
  }

  private textContent(stateProperties: CsStateProperties) {
    if (stateProperties.features.analysis.state === 'loading') return '$(loading~spin) Initializing...';
    if (this.isAnalysing(stateProperties)) return '$(loading~spin) Analysing';
    return `$(cs-logo) ${this.isOnline(stateProperties) ? 'Active/Online' : 'Active'}`;
  }

  private tooltipContent(stateProperties: CsStateProperties) {
    if (this.isAnalysing(stateProperties)) return 'CodeScene analysis in progress...';
    return `${
      this.isOnline(stateProperties) ? 'CodeScene extension active, user signed in' : 'CodeScene extension active'
    }`;
  }

  private indicateErrors(stateProperties: CsStateProperties) {
    const { analysis /*, ace // CS-5069 Remove ACE */ } = stateProperties.features;

    if (analysis.state === 'error' /*|| ace.state === 'error' // CS-5069 Remove ACE */) {
      this.statusBarItem.text = `$(cs-logo) Error`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      this.statusBarItem.tooltip = 'Show in control center';
      this.statusBarItem.command = 'codescene.controlCenterView.focus';
      return;
    }

    if (isDefined(analysis.error) /*|| this.reportableAceError(ace.error) // CS-5069 Remove ACE */) {
      this.statusBarItem.text = `$(cs-logo) Error`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.statusBarItem.tooltip = 'Click to open output log and clear errors.';
      this.statusBarItem.command = 'codescene.extensionState.clearErrors';
      return;
    }
  }

  /**
   * Don't show errors related to credit outages
   */
  // CS-5069 Remove ACE from public version
  // private reportableAceError(error?: Error) {
  //   return isDefined(error) && !(error instanceof CreditsInfoError);
  // }
}
