// This module provides a global interface to the CodeScene output channel.
import * as vscode from 'vscode';

const outputChannel = vscode.window.createOutputChannel('CodeScene');
const logOutputChannel = vscode.window.createOutputChannel('CodeScene Log', { log: true });

export { logOutputChannel, outputChannel };
