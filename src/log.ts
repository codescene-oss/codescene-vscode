// This module provides a global interface to the CodeScene output channel.
import * as vscode from 'vscode';

const logOutputChannel = vscode.window.createOutputChannel('CodeScene w/o ACE', { log: true });

export function registerShowLogCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('codescene-noace.showLogOutput', () => {
      logOutputChannel.show();
    })
  );
}

export { logOutputChannel };
