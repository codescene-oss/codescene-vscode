import vscode from 'vscode';
import type { ObjectivesField } from '../centralized-webview-framework/types';
import type { FeatureFlags } from '../centralized-webview-framework/types/cwf-feature';
import type { ObjectivesSnapshot } from '../centralized-webview-framework/types/objectives';

export const IDE_OBJECTIVES_FLAG: FeatureFlags = 'ide-objectives';
export const IDE_GOAL_FIX_FLAG: FeatureFlags = 'ide-goal-fix';
export const GOAL_WORK_SESSIONS_FLAG: FeatureFlags = 'goal-work-sessions';

let currentSnapshot: ObjectivesSnapshot | undefined;
let workSessionsEnabled = false;
let loading = false;
const changeEmitter = new vscode.EventEmitter<void>();

export const onDidChangeCwfObjectives = changeEmitter.event;

export function setCwfObjectives(snapshot: ObjectivesSnapshot | undefined, opts?: { workSessions: boolean; loading?: boolean }): void {
  currentSnapshot = snapshot;
  workSessionsEnabled = opts?.workSessions ?? false;
  loading = opts?.loading ?? false;
  changeEmitter.fire();
}

export function withCwfObjectives<T extends ObjectivesField & { featureFlags?: FeatureFlags[] }>(props: T): T {
  if (!currentSnapshot && !loading) return props;
  const flags = [IDE_OBJECTIVES_FLAG, IDE_GOAL_FIX_FLAG];
  if (workSessionsEnabled) {
    flags.push(GOAL_WORK_SESSIONS_FLAG);
  }
  return {
    ...props,
    featureFlags: [...(props.featureFlags ?? []), ...flags],
    ...(currentSnapshot ? { objectives: currentSnapshot } : {}),
    ...(loading ? { objectivesLoading: true } : {}),
  };
}
