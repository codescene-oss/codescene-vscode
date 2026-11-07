import type { AuthSnapshot } from './auth-payload';
import { isLicensed } from './license-gate';
import { GATE_SHOWN } from './auth-telemetry';

const ACTIVATION_MESSAGE = 'CodeScene requires a CodeScene account. Sign in to get Code Health analysis in your editor.';
const SIGN_IN_ACTION = 'Sign in';
const USE_ACCESS_TOKEN_ACTION = 'Use access token';

export interface NoticeDeps {
  show(message: string, ...items: string[]): Thenable<string | undefined>;
  signIn(): Thenable<unknown>;
  focusHomeView(): Thenable<unknown>;
  logUsage(name: string, data?: Record<string, unknown>): void;
}

function shouldShowGate(snapshot: AuthSnapshot): boolean {
  if (!snapshot.active) return false;
  if (isLicensed(snapshot)) return false;
  if (snapshot.status?.state === 'signing-in') return false;
  if (snapshot.status?.state === 'signed-in' && snapshot.status.license === null) return false;
  return true;
}

export class AuthNotices {
  private shown = false;
  private gateLogged = false;

  constructor(private readonly deps: NoticeDeps) {}

  async update(snapshot: AuthSnapshot): Promise<void> {
    if (!shouldShowGate(snapshot)) return;
    if (!this.gateLogged) {
      this.gateLogged = true;
      this.deps.logUsage(GATE_SHOWN);
    }
    if (this.shown) return;
    this.shown = true;
    const choice = await this.deps.show(ACTIVATION_MESSAGE, SIGN_IN_ACTION, USE_ACCESS_TOKEN_ACTION);
    if (choice === SIGN_IN_ACTION) await this.deps.signIn();
    else if (choice === USE_ACCESS_TOKEN_ACTION) await this.deps.focusHomeView();
  }
}
