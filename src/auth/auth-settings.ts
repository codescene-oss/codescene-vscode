import vscode from 'vscode';
import debounce = require('lodash.debounce');
import { getConfiguration } from '../configuration';
import type { AuthConfiguration } from './auth-rpc';

export interface AuthSettingsSnapshot {
  signInEnabled: boolean;
  serverUrl: string;
  accessToken: string;
}

export interface AuthSettings {
  read(): AuthSettingsSnapshot;
  setAccessToken(token: string | undefined): Promise<void>;
  readonly onDidChange: vscode.Event<void>;
}

export const AUTH_SETTING_KEYS = ['experimental.signIn', 'serverUrl', 'authToken'] as const;

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function authConfiguration(settings: AuthSettingsSnapshot): AuthConfiguration {
  return {
    'server-url': blankToNull(settings.serverUrl),
    'access-token': blankToNull(settings.accessToken),
  };
}

export function readAuthSettings(): AuthSettingsSnapshot {
  return {
    signInEnabled: getConfiguration<boolean>('experimental.signIn') === true,
    serverUrl: getConfiguration<string>('serverUrl', '') ?? '',
    accessToken: getConfiguration<string>('authToken', '') ?? '',
  };
}

export async function writeAccessToken(token: string | undefined): Promise<void> {
  const config = vscode.workspace.getConfiguration('codescene');
  const value = token?.trim() || undefined;
  const hasWorkspaceValue = config.inspect<string>('authToken')?.workspaceValue !== undefined;
  if (value) {
    const target = hasWorkspaceValue ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await config.update('authToken', value, target);
    return;
  }
  if (hasWorkspaceValue) await config.update('authToken', undefined, vscode.ConfigurationTarget.Workspace);
  await config.update('authToken', undefined, vscode.ConfigurationTarget.Global);
}

export class VsCodeAuthSettings implements AuthSettings, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly fireChange = debounce(() => this.emitter.fire(), 500);
  private readonly subscription: vscode.Disposable;
  readonly onDidChange = this.emitter.event;

  constructor() {
    this.subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (AUTH_SETTING_KEYS.some((key) => event.affectsConfiguration(`codescene.${key}`))) this.fireChange();
    });
  }

  read(): AuthSettingsSnapshot {
    return readAuthSettings();
  }

  setAccessToken(token: string | undefined): Promise<void> {
    return writeAccessToken(token);
  }

  dispose(): void {
    this.fireChange.cancel();
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
