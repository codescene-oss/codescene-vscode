import type { AuthStatus } from '../centralized-webview-framework/types/auth';
import type { AuthSnapshot } from './auth-payload';

export interface LicenseHooks {
  onUnlicensed(): void;
  onLicensed(): void;
  onServerRelicensed(): void;
}

export function isLicensed(snapshot: Pick<AuthSnapshot, 'active' | 'status'>): boolean {
  return snapshot.active && snapshot.status?.state === 'signed-in' && snapshot.status.license?.state === 'valid';
}

export function isLicenseResolving(status: AuthStatus | null): boolean {
  return status?.state === 'signed-in' && status.license === null;
}

export class LicenseGate {
  private current = false;
  private serverStart = 0;

  constructor(private readonly deps: LicenseHooks) {}

  get licensed(): boolean {
    return this.current;
  }

  update(snapshot: AuthSnapshot): void {
    const answeredNewServer = snapshot.serverStart !== this.serverStart;
    this.serverStart = snapshot.serverStart;
    const next = isLicensed(snapshot);
    if (next === this.current) {
      if (next && answeredNewServer) this.deps.onServerRelicensed();
      return;
    }
    this.current = next;
    if (next) this.deps.onLicensed();
    else this.deps.onUnlicensed();
  }
}
