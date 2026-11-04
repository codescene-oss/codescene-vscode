import type { AuthStep } from '../centralized-webview-framework/types/auth';
import type { AuthSnapshot } from './auth-payload';

export type AuthSurface = 'monitor' | 'auth';

export interface FlowState {
  kind: 'idle' | 'sign-in' | 'manual-account' | 'manual-project';
  resolved: boolean;
  accountChosen: boolean;
  projectSkipped: boolean;
}

export const IDLE_FLOW: FlowState = {
  kind: 'idle',
  resolved: false,
  accountChosen: false,
  projectSkipped: false,
};

function needsAccountPick(flow: FlowState, snapshot: AuthSnapshot): boolean {
  const several = (snapshot.accounts?.length ?? 0) > 1;
  return several && !snapshot.linkedProject && !flow.accountChosen;
}

function needsProjectPick(flow: FlowState, snapshot: AuthSnapshot): boolean {
  const hasProjects = (snapshot.projects?.length ?? 0) > 0;
  return !!snapshot.repo && hasProjects && !snapshot.linkedProject && !flow.projectSkipped;
}

export function nextStep(flow: FlowState, snapshot: AuthSnapshot): AuthStep | 'done' {
  if (flow.kind === 'idle' || snapshot.status?.state !== 'signed-in') return 'summary';
  if (flow.kind === 'manual-account') return flow.accountChosen ? 'done' : 'pick-account';
  if (flow.kind === 'manual-project') return 'pick-project';
  if (!flow.resolved) return 'resolving';
  if (needsAccountPick(flow, snapshot)) return 'pick-account';
  return needsProjectPick(flow, snapshot) ? 'pick-project' : 'done';
}
