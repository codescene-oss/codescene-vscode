import type { AuthErrorCode, AuthStatus } from '../centralized-webview-framework/types/auth';

export interface AuthTelemetryEvent {
  name: string;
  data?: Record<string, unknown>;
}

export function signInFailed(code: AuthErrorCode | undefined): AuthTelemetryEvent {
  return { name: 'auth/sign-in-failed', data: { 'error-code': code ?? 'unknown' } };
}

export function signInOutcome(previous: AuthStatus | null, next: AuthStatus): AuthTelemetryEvent | undefined {
  if (previous?.state !== 'signing-in' || next.state === 'signing-in') return undefined;
  const code = next.error?.code;
  if (code === 'auth/cancelled') return { name: 'auth/sign-in-cancelled' };
  if (code || next.state !== 'signed-in') return signInFailed(code);
  return { name: 'auth/sign-in-completed' };
}
