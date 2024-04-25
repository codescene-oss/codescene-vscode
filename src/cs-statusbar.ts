import vscode from 'vscode';
import { CsStateProperties } from './cs-extension-state';
import { isDefined } from './utils';

export class CsStatusBar {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      'codescene.statusBarItem',
      vscode.StatusBarAlignment.Right,
      -1
    );
    this.setState();
    this.statusBarItem.show();
  }

  update(stateProperties: CsStateProperties) {
    this.setState(stateProperties);
    this.indicateErrors(stateProperties);
  }

  private setState(stateProperties?: CsStateProperties) {
    this.statusBarItem.name = 'CodeScene status bar';
    this.statusBarItem.text = this.textContent(stateProperties);
    this.statusBarItem.tooltip = this.tooltipContent(stateProperties);
    this.statusBarItem.command = 'codescene.statusView.focus';
    this.statusBarItem.backgroundColor = undefined;
  }

  private isOnline(stateProperties?: CsStateProperties) {
    return isDefined(stateProperties?.session);
  }

  private isReviewing(stateProperties?: CsStateProperties) {
    return isDefined(stateProperties?.reviewerState) && stateProperties?.reviewerState !== 'idle';
  }

  private textContent(stateProperties?: CsStateProperties) {
    if (this.isReviewing(stateProperties)) return '$(loading~spin) Reviewing';
    return `$(cs-logo) ${this.isOnline(stateProperties) ? 'Active/Online' : 'Active'}`;
  }

  private tooltipContent(stateProperties?: CsStateProperties) {
    if (this.isReviewing(stateProperties)) return 'CodeScene review in progress...';
    return `${
      this.isOnline(stateProperties) ? 'CodeScene extension active, user signed in' : 'CodeScene extension active'
    }`;
  }

  private indicateErrors(stateProperties: CsStateProperties) {
    if (stateProperties.features?.codeHealthAnalysis instanceof Error) {
      // Indicates an error in d/l or verifying the CLI
      this.statusBarItem.text = `$(cs-logo) Error`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      this.statusBarItem.tooltip = 'Click to open the status view.';
    } else if (isDefined(stateProperties.serviceErrors) && stateProperties.serviceErrors.length > 0) {
      // Indicates a service/reviewer error
      this.statusBarItem.text = `$(cs-logo) Error`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.statusBarItem.tooltip = 'Click to open the status view.';
    }
  }
}
