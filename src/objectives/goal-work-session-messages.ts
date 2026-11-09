import { REAUTHORIZE_COMMAND, SIGN_IN_COMMAND } from '../auth/auth-commands';
import type { GoalWorkSessionRpc, GoalWorkSessionStartResult } from './goal-work-session-rpc';
import type { ObjectivesSnapshot } from '../centralized-webview-framework/types/objectives';

interface GoalWorkSessionDeps {
  rpc: GoalWorkSessionRpc;
  snapshot: () => ObjectivesSnapshot | undefined;
  capable: () => boolean;
  canReauthorize: () => boolean;
  notify: {
    warn: (message: string, ...actions: string[]) => Thenable<string | undefined>;
    info: (message: string) => Thenable<void>;
  };
  executeCommand: (id: string) => Thenable<unknown>;
  log?: (message: string) => void;
}

type StartResult = GoalWorkSessionStartResult['result'];

const START_RESULT_WARNINGS: Partial<Record<StartResult, string>> = {
  'goal-inactive': "This Goal is no longer active, so a work session can't be started.",
  'parent-inactive': "This Goal's Policy is inactive, so a work session can't be started.",
  network: "Couldn't reach CodeScene to start the work session. Try again.",
};

function warnWithAction(deps: GoalWorkSessionDeps, message: string, action: string, command: string): void {
  void deps.notify.warn(message, action).then(
    (chosen) => {
      if (chosen === action) {
        void deps.executeCommand(command);
      }
    },
    (error) => deps.log?.(`[goal-work-sessions] Notification failed: ${String(error)}`)
  );
}

function notifyStartResult(result: StartResult, deps: GoalWorkSessionDeps): void {
  const warning = START_RESULT_WARNINGS[result];
  if (warning) {
    void deps.notify.warn(warning);
  } else if (result === 'scope-missing') {
    notifyScopeMissing(deps);
  } else if (result === 'signed-out') {
    warnWithAction(deps, 'Sign in to CodeScene to use work sessions.', 'Sign in', SIGN_IN_COMMAND);
  }
}

function notifyScopeMissing(deps: GoalWorkSessionDeps): void {
  if (!deps.canReauthorize()) {
    void deps.notify.warn("Your access token doesn't allow work sessions.");
    return;
  }
  warnWithAction(deps, 'Re-authorize CodeScene to use work sessions.', 'Re-authorize', REAUTHORIZE_COMMAND);
}

export async function handleGoalWorkSessionStart(goalId: number, deps: GoalWorkSessionDeps): Promise<void> {
  if (!deps.capable()) {
    deps.log?.(`[goal-work-sessions] Ignoring work session start: capability not present`);
    return;
  }

  const snapshot = deps.snapshot();
  if (!snapshot) {
    deps.log?.(`[goal-work-sessions] Goal ${goalId} not found in any snapshot`);
    return;
  }

  const repoPath = snapshot['repo-root'];

  let result;
  try {
    result = await deps.rpc.start(repoPath, goalId);
  } catch (error) {
    deps.log?.(`[goal-work-sessions] Start failed: ${String(error)}`);
    void deps.notify.warn("Couldn't reach CodeScene to start the work session. Try again.");
    return;
  }

  notifyStartResult(result.result, deps);
}
