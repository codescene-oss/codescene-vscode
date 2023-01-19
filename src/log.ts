// This module provides a global interface to the CodeScene output channel.
import * as vscode from 'vscode';

console.log('CodeScene: creating output channel');
let outputChannel = vscode.window.createOutputChannel('CodeScene');

export { outputChannel };
