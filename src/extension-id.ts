import vscode from 'vscode';

let extensionId = 'codescene.codescene-vscode';

export function initExtensionId(context: vscode.ExtensionContext): void {
  extensionId = context.extension.id;
}

export function getExtensionId(): string {
  return extensionId;
}

export function getExtensionSettingsFilter(): string {
  return `@ext:${extensionId}`;
}
