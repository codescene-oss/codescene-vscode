import vscode from 'vscode';

export class CsStatusBar {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      'codescene.statusBarItem',
      vscode.StatusBarAlignment.Right,
      -1
    );
    this.statusBarItem.name = 'CodeScene status bar';
    this.statusBarItem.text = '$(cs-logo)';
    this.statusBarItem.command = 'codescene.statusView.focus';
    this.statusBarItem.show();
  }

  setOnline(online?: boolean) {
    this.statusBarItem.text = `$(cs-logo) ${online ? 'Online' : ''}`;
  }
}
