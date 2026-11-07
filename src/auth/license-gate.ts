import type { AuthSnapshot } from './auth-payload';

export interface LicenseHooks {
  onUnlicensed(): void;
  onLicensed(): void;
}

export function isLicensed(snapshot: AuthSnapshot): boolean {
  return snapshot.active && snapshot.status?.state === 'signed-in' && snapshot.status.license?.state === 'valid';
}

export class LicenseGate {
  private current = false;

  constructor(private readonly deps: LicenseHooks) {}

  get licensed(): boolean {
    return this.current;
  }

  update(snapshot: AuthSnapshot): void {
    const next = isLicensed(snapshot);
    if (next === this.current) return;
    this.current = next;
    if (next) this.deps.onLicensed();
    else this.deps.onUnlicensed();
  }
}
