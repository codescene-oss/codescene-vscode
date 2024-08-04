import * as vscode from 'vscode';

export function getConfiguration<T>(section: string): T | undefined {
  return vscode.workspace.getConfiguration('codescene').get<T>(section);
}

export function onDidChangeConfiguration(
  section: string,
  listener: (e: { event: vscode.ConfigurationChangeEvent; value: any }) => any
) {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('codescene.' + section)) {
      listener({ event: e, value: getConfiguration(section) });
    }
  });
}

/**
 * Get the configured URL of the CodeScene server.
 */
export function getServerUrl() {
  return getConfiguration<string>('serverUrl');
}
