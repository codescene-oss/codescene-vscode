import * as fs from 'fs';
import * as path from 'path';
import type { AuthPayload, AuthStatus } from '../../../centralized-webview-framework/types/auth';

export type AuthStatusFixture =
  | 'env-token-override'
  | 'signed-in-network-error'
  | 'signed-in-oauth'
  | 'signed-in-oauth-setting-token-rejected'
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
