import vscode from 'vscode';
import type { AuthField } from '../centralized-webview-framework/types';
import type { AuthPayload } from '../centralized-webview-framework/types/auth';
import type { FeatureFlags } from '../centralized-webview-framework/types/cwf-feature';

export const IDE_AUTH_FLAG: FeatureFlags = 'ide-auth';

let currentPayload: AuthPayload | undefined;
const changeEmitter = new vscode.EventEmitter<void>();

export const onDidChangeCwfAuth = changeEmitter.event;

export function setCwfAuth(payload: AuthPayload | undefined): void {
  currentPayload = payload;
  changeEmitter.fire();
}

export function cwfAuthActive(): boolean {
  return currentPayload !== undefined;
}

export function withCwfAuth<T extends AuthField & { featureFlags?: FeatureFlags[] }>(props: T): T {
  if (!currentPayload) return props;
  return { ...props, featureFlags: [...(props.featureFlags ?? []), IDE_AUTH_FLAG], auth: currentPayload };
}
