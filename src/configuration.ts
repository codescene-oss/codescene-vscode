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
