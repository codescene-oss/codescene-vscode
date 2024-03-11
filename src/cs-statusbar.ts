import vscode from 'vscode';
import { CsStateProperties } from './cs-extension-state';
import { isDefined } from './utils';

export class CsStatusBar {
  private readonly statusBarItem: vscode.StatusBarItem;
  private isOnline?: boolean;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      'codescene.statusBarItem',
      vscode.StatusBarAlignment.Right,
      -1
    );
    this.defaultState();
    this.statusBarItem.show();
  }

  update(stateProperties: CsStateProperties) {
    this.setOnline(isDefined(stateProperties.session));
    this.indicateErrors(stateProperties);
  }

  private defaultState() {
    this.statusBarItem.name = 'CodeScene status bar';
    this.statusBarItem.text = this.textContent();
    this.statusBarItem.tooltip = this.tooltipContent();
    this.statusBarItem.command = 'codescene.statusView.focus';
    this.statusBarItem.backgroundColor = undefined;
  }

  private textContent() {
    return `$(cs-logo) ${this.isOnline ? 'Signed in' : ''}`;
  }
  private tooltipContent() {
    return `${this.isOnline ? 'CodeScene extension active, user signed in' : 'CodeScene extension active'}`;
  }

  private setOnline(online?: boolean) {
    this.isOnline = online;
    this.defaultState();
  }

  private indicateErrors(stateProperties: CsStateProperties) {
    if (stateProperties.features?.codeHealthAnalysis instanceof Error) {
      // Indicates an error in d/l or verifying the CLI
      this.statusBarItem.text = `$(cs-logo) Error`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      this.statusBarItem.tooltip = 'Click to open the status view.';
    } else if (isDefined(stateProperties.serviceErrors) && stateProperties.serviceErrors.length > 0) {
      // Indicates a service error
      this.statusBarItem.text = `$(cs-logo) Service error`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.statusBarItem.tooltip = 'Click to open the status view.';
    } else {
      this.defaultState();
    }
  }
}
