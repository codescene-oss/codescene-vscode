import vscode from 'vscode';
import type { ObjectivesField } from '../centralized-webview-framework/types';
import type { FeatureFlags } from '../centralized-webview-framework/types/cwf-feature';
import type { ObjectivesSnapshot } from '../centralized-webview-framework/types/objectives';

export const IDE_OBJECTIVES_FLAG: FeatureFlags = 'ide-objectives';

let currentSnapshot: ObjectivesSnapshot | undefined;
const changeEmitter = new vscode.EventEmitter<void>();

export const onDidChangeCwfObjectives = changeEmitter.event;

export function setCwfObjectives(snapshot: ObjectivesSnapshot | undefined): void {
  currentSnapshot = snapshot;
  changeEmitter.fire();
}

export function withCwfObjectives<T extends ObjectivesField & { featureFlags?: FeatureFlags[] }>(props: T): T {
  if (!currentSnapshot) return props;
  return {
    ...props,
    featureFlags: [...(props.featureFlags ?? []), IDE_OBJECTIVES_FLAG],
    objectives: currentSnapshot,
  };
}
