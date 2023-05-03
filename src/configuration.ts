import * as vscode from 'vscode';

export function getConfiguration<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration('codescene').get<T>(key);
}

/**
 * Get the configured URL of the CodeScene server.
 *
 * TODO: it should be able to adapt to the user's choice of cloud or on-premises server.
 */
export function getServerUrl() {
  return getConfiguration<string>('cloudUrl');
}

/**
 * Get the configured API URL of the CodeScene server.
 *
 * TODO: it should be able to adapt to the user's choice of cloud or on-premises server.
 */
export function getServerApiUrl() {
  return getConfiguration<string>('cloudApiUrl');
}
