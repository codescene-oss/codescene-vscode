import * as vscode from 'vscode';
import { logOutputChannel } from './log';

export function getConfiguration<T>(section: string): T | undefined {
  return vscode.workspace.getConfiguration('codescene').get<T>(section);
}

export function setConfiguration(section: string, value: any) {
  const codesceneConfig = vscode.workspace.getConfiguration('codescene');
  codesceneConfig.update(section, value).then(
    () => {},
    (err) => {
      logOutputChannel.error(`setConfiguration(${section}) failed: ${err}`);
    }
  );
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

/**
 * Get the configured URL of the CodeScene Devtool Portal server.
 */
export function getPortalUrl() {
  return getConfiguration<string>('devtoolsPortalUrl');
}

export function reviewCodeLensesEnabled() {
  return getConfiguration<boolean>('enableReviewCodeLenses');
}

export function toggleReviewCodeLenses() {
  const state = reviewCodeLensesEnabled();
  setConfiguration('enableReviewCodeLenses', !state);
}