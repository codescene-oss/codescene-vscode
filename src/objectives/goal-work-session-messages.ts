import { REAUTHORIZE_COMMAND, SIGN_IN_COMMAND } from '../auth/auth-commands';
import type { GoalWorkSessionRpc } from './goal-work-session-rpc';
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

  switch (result.result) {
    case 'started':
    case 'unavailable':
      // No notification
      break;
    case 'goal-inactive':
      void deps.notify.warn("This Goal is no longer active, so a work session can't be started.");
      break;
    case 'parent-inactive':
      void deps.notify.warn("This Goal's Policy is inactive, so a work session can't be started.");
      break;
    case 'network':
      void deps.notify.warn("Couldn't reach CodeScene to start the work session. Try again.");
      break;
    case 'scope-missing':
      if (!deps.canReauthorize()) {
        void deps.notify.warn("Your access token doesn't allow work sessions.");
        break;
      }
      void deps.notify
        .warn('Re-authorize CodeScene to use work sessions.', 'Re-authorize')
        .then(
          (action) => {
            if (action === 'Re-authorize') {
              void deps.executeCommand(REAUTHORIZE_COMMAND);
            }
          },
          (error) => deps.log?.(`[goal-work-sessions] Notification failed: ${String(error)}`)
        );
      break;
    case 'signed-out':
      void deps.notify
        .warn('Sign in to CodeScene to use work sessions.', 'Sign in')
        .then(
          (action) => {
            if (action === 'Sign in') {
              void deps.executeCommand(SIGN_IN_COMMAND);
            }
          },
          (error) => deps.log?.(`[goal-work-sessions] Notification failed: ${String(error)}`)
        );
      break;
  }
}
