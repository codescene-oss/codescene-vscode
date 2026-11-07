import vscode from 'vscode';
import type { AuthField } from '../centralized-webview-framework/types';
import type { AuthFlow, AuthPayload } from '../centralized-webview-framework/types/auth';
import type { FeatureFlags } from '../centralized-webview-framework/types/cwf-feature';
import type { AuthSurface } from './auth-flow';

export const IDE_AUTH_FLAG: FeatureFlags = 'ide-auth';

let currentPayload: AuthPayload | undefined;
let currentFlow: AuthFlow | undefined;
let currentSurface: AuthSurface = 'monitor';
let currentPro = false;
const changeEmitter = new vscode.EventEmitter<void>();

export const onDidChangeCwfAuth = changeEmitter.event;

export function setCwfAuth(
  payload: AuthPayload | undefined,
  flow?: AuthFlow,
  surface: AuthSurface = 'monitor',
  pro = false
): void {
  currentPayload = payload;
  currentFlow = flow;
  currentSurface = surface;
  currentPro = pro;
  changeEmitter.fire();
}

export function cwfAuthSurface(): AuthSurface {
  return currentPayload ? currentSurface : 'monitor';
}

export function cwfAuthActive(): boolean {
  return currentPayload !== undefined;
}

export function cwfAuthPro(): boolean {
  return currentPro;
}

export function withCwfAuth<T extends AuthField & { featureFlags?: FeatureFlags[] }>(props: T): T {
  if (!currentPayload) return props;
  return {
    ...props,
    featureFlags: [...(props.featureFlags ?? []), IDE_AUTH_FLAG],
    auth: currentPayload,
    ...(currentFlow ? { authFlow: currentFlow } : {}),
  };
}
