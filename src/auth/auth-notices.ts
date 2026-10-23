import type { Memento } from 'vscode';
import type { AuthError, AuthStatus } from '../centralized-webview-framework/types/auth';
import type { AuthSnapshot } from './auth-payload';

export const SIGN_IN_ACTION = 'Sign in';
export const DONT_SHOW_AGAIN = "Don't show again";
export const SIGN_IN_NUDGE = 'Sign in to CodeScene in your browser to connect the extension to your account.';
export const SIGN_IN_NUDGE_DISMISSED_KEY = 'codescene.auth.signInNudgeDismissed';

export interface NoticeActions {
  show(message: string, ...items: string[]): Thenable<string | undefined>;
  signIn(): Thenable<unknown>;
}

function nudgeAllowedAfter(error: AuthError | null): boolean {
  return error === null || error.code === 'auth/invalid-token';
}

function nudgeableStatus(status: AuthStatus | null): boolean {
  if (status?.state !== 'signed-out') return false;
  if (status['env-token-present']) return false;
  return status['oauth-supported'] !== false && nudgeAllowedAfter(status.error);
}

export function shouldNudge(snapshot: AuthSnapshot): boolean {
  return snapshot.active && nudgeableStatus(snapshot.status);
}

export class AuthNotices {
  private shown = false;

  constructor(
    private readonly state: Pick<Memento, 'get' | 'update'>,
    private readonly actions: NoticeActions
  ) {}

  async update(snapshot: AuthSnapshot): Promise<void> {
    if (!this.canShow(snapshot)) return;
    this.shown = true;
    const choice = await this.actions.show(SIGN_IN_NUDGE, SIGN_IN_ACTION, DONT_SHOW_AGAIN);
    if (choice === DONT_SHOW_AGAIN) await this.state.update(SIGN_IN_NUDGE_DISMISSED_KEY, true);
    else if (choice === SIGN_IN_ACTION) await this.actions.signIn();
  }

  private canShow(snapshot: AuthSnapshot): boolean {
    if (this.shown || this.state.get<boolean>(SIGN_IN_NUDGE_DISMISSED_KEY)) return false;
    return shouldNudge(snapshot);
  }
}
