import vscode from 'vscode';
import type { ObjectivesField } from '../centralized-webview-framework/types';
import type { FeatureFlags } from '../centralized-webview-framework/types/cwf-feature';
import type { ObjectivesSnapshot } from '../centralized-webview-framework/types/objectives';

export const IDE_OBJECTIVES_FLAG: FeatureFlags = 'ide-objectives';
export const GOAL_WORK_SESSIONS_FLAG: FeatureFlags = 'goal-work-sessions';

let currentSnapshot: ObjectivesSnapshot | undefined;
let workSessionsEnabled = false;
const changeEmitter = new vscode.EventEmitter<void>();

export const onDidChangeCwfObjectives = changeEmitter.event;

export function setCwfObjectives(snapshot: ObjectivesSnapshot | undefined, opts?: { workSessions: boolean }): void {
  currentSnapshot = snapshot;
  workSessionsEnabled = opts?.workSessions ?? false;
  changeEmitter.fire();
}

export function withCwfObjectives<T extends ObjectivesField & { featureFlags?: FeatureFlags[] }>(props: T): T {
  if (!currentSnapshot) return props;
  const flags = [IDE_OBJECTIVES_FLAG];
  if (workSessionsEnabled) {
    flags.push(GOAL_WORK_SESSIONS_FLAG);
  }
  return {
    ...props,
    featureFlags: [...(props.featureFlags ?? []), ...flags],
    objectives: currentSnapshot,
  };
}
