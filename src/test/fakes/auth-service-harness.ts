import { AuthService } from '../../auth/auth-service';
import { FakeAuthSettings } from './fake-auth-settings';
import { FakeAuthTransport } from './fake-auth-transport';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';

export interface Harness {
  service: AuthService;
  transport: FakeAuthTransport;
  settings: FakeAuthSettings;
  events: Array<{ name: string; data?: Record<string, unknown> }>;
  opened: string[];
}

export interface HarnessOptions {
  capabilities?: string[];
  signInEnabled?: boolean;
  accessToken?: string;
}


export function createHarness(options: HarnessOptions = {}): Harness {
  const transport = new FakeAuthTransport({ sha: 'sha', version: 'version', capabilities: options.capabilities ?? ['auth-v1'] })
    .respond('cs-ide/auth-configure', () => authStatusFixture('signed-out'))
    .respond('cs-ide/auth-list-accounts', () => [])
    .respond('cs-ide/projects-list', () => [])
    .respond('cs-ide/project-link-get', () => ({ project: null }))
    .respond('cs-ide/auth-sync-account', () => {
      throw Object.assign(new Error('Method not found'), { code: -32601 });
    });
  const settings = new FakeAuthSettings({
    signInEnabled: options.signInEnabled ?? true,
    serverUrl: '',
    accessToken: options.accessToken ?? '',
  });
  const events: Harness['events'] = [];
  const opened: string[] = [];
  const service = new AuthService({
    transport,
    settings,
    openExternal: async (url) => {
      opened.push(url);
    },
    logUsage: (name, data) => events.push(data ? { name, data } : { name }),
  });
  return { service, transport, settings, events, opened };
}
