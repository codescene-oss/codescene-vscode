import * as fs from 'fs';
import * as path from 'path';
import { INACTIVE_SNAPSHOT, type AuthSnapshot } from '../../../auth/auth-payload';
import { LicenseGate } from '../../../auth/license-gate';
import type { AuthPayload, AuthStatus } from '../../../centralized-webview-framework/types/auth';

export type AuthStatusFixture =
  | 'env-token-override'
  | 'signed-in-network-error'
  | 'signed-in-oauth'
  | 'signed-in-oauth-setting-token-rejected'
  | 'signed-in-offline-expired'
  | 'signed-in-refused'
  | 'signed-in-setting-token-onprem'
  | 'signed-out'
  | 'signed-out-env-token-invalid'
  | 'signed-out-oauth-unsupported'
  | 'signed-out-session-revoked'
  | 'signed-out-timeout'
  | 'signing-in';

export type AuthPayloadFixture = 'auth-payload-account-pick' | 'auth-payload-linked-project';

export const AUTH_STATUS_FIXTURES: readonly AuthStatusFixture[] = [
  'env-token-override',
  'signed-in-network-error',
  'signed-in-oauth',
  'signed-in-oauth-setting-token-rejected',
  'signed-in-offline-expired',
  'signed-in-refused',
  'signed-in-setting-token-onprem',
  'signed-out',
  'signed-out-env-token-invalid',
  'signed-out-oauth-unsupported',
  'signed-out-session-revoked',
  'signed-out-timeout',
  'signing-in',
];

const fixtureDir = path.join(__dirname, '../../../../src/test/fixtures/auth');

function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, `${name}.json`), 'utf8')) as T;
}

export function authStatusFixture(name: AuthStatusFixture): AuthStatus {
  return readFixture<AuthStatus>(name);
}

export function authPayloadFixture(name: AuthPayloadFixture): AuthPayload {
  return readFixture<AuthPayload>(name);
}

export function snapshotWith(status: AuthStatus | null): AuthSnapshot {
  return { ...INACTIVE_SNAPSHOT, active: true, status };
}

export function licensedSnapshot(): AuthSnapshot {
  return snapshotWith(authStatusFixture('signed-in-oauth'));
}

export function licensedGate(): LicenseGate {
  const gate = new LicenseGate({ onLicensed: () => undefined, onUnlicensed: () => undefined });
  gate.update(licensedSnapshot());
  return gate;
}
