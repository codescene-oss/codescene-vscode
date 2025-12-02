import * as vscode from 'vscode';
import { logOutputChannel } from './log';

function getFirstNonBlankString(config: vscode.WorkspaceConfiguration, section: string, defaultValue: string): string {
  // This fallback logic prevents a bad behavior where a blank (perhaps even unset) Workspace value
  // can take priority over a non-blank User value.
  const sources = [
    config.get<string>(section, defaultValue) || '',       // First priority: default VS Code logic
    config.inspect<string>(section)?.workspaceValue || '', // Second priority: Workspace
    config.inspect<string>(section)?.globalValue || '',    // Last priority: User
  ];

  for (const value of sources) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return defaultValue;
}

export function getConfiguration<T>(section: string, defaultValue?: T): T | undefined {
  const config = vscode.workspace.getConfiguration('codescene');

  if (defaultValue === '') { // If the requested config is of type String, we can apply the following fallback logic:
    return getFirstNonBlankString(config, section, defaultValue as string) as T;
  }

  if (!defaultValue) {
    return config.get<T>(section);
  }

  return config.get<T>(section, defaultValue);
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

export function getServerUrl() {
  return "https://codescene.io";
}

export function reviewCodeLensesEnabled() {
  return getConfiguration<boolean>('enableReviewCodeLenses');
}

export function toggleReviewCodeLenses() {
  const state = reviewCodeLensesEnabled();
  setConfiguration('enableReviewCodeLenses', !state);
}

export function getAuthToken() {
  return getConfiguration<string>('authToken', '');
}
