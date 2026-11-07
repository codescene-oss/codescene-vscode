import { SIGN_IN_COMMAND } from '../auth/auth-commands';
import type { GoalWorkSessionRpc } from './goal-work-session-rpc';
import type { ObjectivesSnapshot } from '../centralized-webview-framework/types/objectives';

interface GoalWorkSessionDeps {
  rpc: GoalWorkSessionRpc;
  snapshot: () => ObjectivesSnapshot | undefined;
  capable: () => boolean;
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

  try {
    const result = await deps.rpc.start(repoPath, goalId);

    switch (result.result) {
      case 'started':
      case 'unavailable':
        // No notification
        break;
      case 'goal-inactive':
        await deps.notify.warn("This Goal is no longer active, so a work session can't be started.");
        break;
      case 'parent-inactive':
        await deps.notify.warn("This Goal's Policy is inactive, so a work session can't be started.");
        break;
      case 'network':
        await deps.notify.warn("Couldn't reach CodeScene to start the work session. Try again.");
        break;
      case 'scope-missing': {
        const action = await deps.notify.warn('Re-authorize CodeScene to use work sessions.', 'Re-authorize');
        if (action === 'Re-authorize') {
          await deps.executeCommand('codescene.reauthorize');
        }
        break;
      }
      case 'signed-out': {
        const action = await deps.notify.warn('Sign in to CodeScene to use work sessions.', 'Sign in');
        if (action === 'Sign in') {
          await deps.executeCommand(SIGN_IN_COMMAND);
        }
        break;
      }
    }
  } catch (error) {
    deps.log?.(`[goal-work-sessions] Start failed: ${String(error)}`);
    await deps.notify.warn("Couldn't reach CodeScene to start the work session. Try again.");
  }
}
