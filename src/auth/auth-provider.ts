import { v4 as uuid } from 'uuid';
import {
  AuthenticationProvider,
  AuthenticationProviderAuthenticationSessionsChangeEvent,
  AuthenticationSession,
  CancellationTokenSource,
  Disposable,
  EventEmitter,
  ExtensionContext,
  ProgressLocation,
  Uri,
  UriHandler,
  authentication,
  env,
  window,
} from 'vscode';
import { getServerUrl } from '../configuration';
import { logOutputChannel } from '../log';
import { CsServerVersion, ServerVersion } from '../server-version';
import Telemetry from '../telemetry';
import { PromiseAdapter, promiseFromEvent } from './util';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const AUTH_TYPE = 'codescene';
// eslint-disable-next-line @typescript-eslint/naming-convention
const SESSIONS_STORAGE_KEY = `${AUTH_TYPE}.sessions`;

class UriEventHandler extends EventEmitter<Uri> implements UriHandler {
  public handleUri(uri: Uri) {
    this.fire(uri);
  }
}

interface LoginResponse {
  name: string;
  token: string;
  userId: string;
}

export interface CodeSceneAuthenticationSession extends AuthenticationSession {
  url: string;
  version: ServerVersion;
}

export class CsAuthenticationProvider implements AuthenticationProvider, Disposable {
  private static runningLogin?: CancellationTokenSource;
  private sessionChangeEmitter = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
  private disposable: Disposable;
  private uriHandler = new UriEventHandler();

  constructor(private context: ExtensionContext) {
    this.disposable = Disposable.from(
      authentication.registerAuthenticationProvider(AUTH_TYPE, 'CodeScene Tools', this, {
        supportsMultipleAccounts: false,
      }),
      window.registerUriHandler(this.uriHandler)
    );
  }

  get onDidChangeSessions() {
    return this.sessionChangeEmitter.event;
  }

  /**
   * Get the existing sessions.
   * @param scopes
   * @returns
   */
  public async getSessions(scopes?: string[]): Promise<readonly AuthenticationSession[]> {
    const allSessions = await this.context.secrets.get(SESSIONS_STORAGE_KEY);

    if (allSessions) {
      return JSON.parse(allSessions) as CodeSceneAuthenticationSession[];
    }

    return [];
  }

  /**
   * Create a new auth session
   * @param scopes
   * @returns
   */
  public async createSession(scopes: string[]): Promise<AuthenticationSession> {
    const loginResponse = await this.login();

    if (!loginResponse) {
      throw new Error('Login failure');
    }

    const info = await CsServerVersion.info;

    const session: CodeSceneAuthenticationSession = {
      id: uuid(), // Do we need a "static" id here?
      accessToken: loginResponse.token,
      account: {
        label: loginResponse.name,
        id: loginResponse.userId || uuid(), // Do we need a "static" id here?
      },
      scopes: [],
      version: info.version,
      url: info.url,
    };

    await this.context.secrets.store(SESSIONS_STORAGE_KEY, JSON.stringify([session]));

    this.sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });

    logOutputChannel.info(`Created session ${session.id} for ${session.account.label}`);

    void window.showInformationMessage(`Signed in to CodeScene as ${session.account.label}`);

    return session;
  }

  /**
   * Remove an existing session
   * @param sessionId
   */
  public async removeSession(sessionId: string): Promise<void> {
    const allSessions = await this.context.secrets.get(SESSIONS_STORAGE_KEY);
    if (allSessions) {
      let sessions = JSON.parse(allSessions) as AuthenticationSession[];
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        await this.context.secrets.store(SESSIONS_STORAGE_KEY, '[]');
        this.sessionChangeEmitter.fire({ added: [], removed: [session], changed: [] });
      }
    }
  }

  /**
   * Dispose the registered services
   */
  public async dispose() {
    this.disposable.dispose();
  }

  private async loginUrl(): Promise<Uri> {
    let info = await CsServerVersion.info;
    if (info.version.server === 'cloud') {
      const tokenParams = new URLSearchParams({
        next: `/configuration/devtools-tokens/add/vscode`,
      });
      return Uri.parse(`${getServerUrl()}/login?${tokenParams.toString()}`);
    } else {
      const tokenParams = new URLSearchParams({
        vscode: 'true',
      });
      return Uri.parse(`${getServerUrl()}/configuration/user/token?${tokenParams.toString()}`);
    }
  }

  /**
   * Log in to CodeScene
   */
  private async login() {
    this.cancelLogin();
    Telemetry.logUsage('auth/attempted');
    return window.withProgress<LoginResponse>(
      {
        location: ProgressLocation.Notification,
        title: 'Signing in to CodeScene...',
        cancellable: true,
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      async (_, cancelButtonToken) => {
        const loginUrl = await this.loginUrl();
        logOutputChannel.debug(`Opening ${loginUrl.toString()}`);

        await env.openExternal(loginUrl);

        const promises: Promise<any>[] = [];
        const codeExchangePromise = promiseFromEvent(this.uriHandler.event, this.handleUri());
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const timeoutPromise = new Promise<LoginResponse>((_, reject) => setTimeout(() => reject('Cancelled'), 60000));
        const cancelledByButtonPromise = promiseFromEvent(
          cancelButtonToken.onCancellationRequested,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          (_, __, reject) => {
            Telemetry.logUsage('auth/cancelled');
            reject('User Cancelled');
          }
        ).promise;
        promises.push(codeExchangePromise.promise, timeoutPromise, cancelledByButtonPromise);

        if (CsAuthenticationProvider.runningLogin) {
          promises.push(
            // eslint-disable-next-line @typescript-eslint/naming-convention
            promiseFromEvent(CsAuthenticationProvider.runningLogin.token.onCancellationRequested, (_, __, reject) => {
              Telemetry.logUsage('auth/cancelled');
              reject('Cancelled due to starting another login attempt');
            }).promise
          );
        }

        try {
          return await Promise.race(promises);
        } finally {
          codeExchangePromise.cancel.fire();
        }
      }
    );
  }

  // Cancel currently running login (if any)
  cancelLogin() {
    if (CsAuthenticationProvider.runningLogin) CsAuthenticationProvider.runningLogin.cancel();
    CsAuthenticationProvider.runningLogin = new CancellationTokenSource();
  }

  /**
   * Handle the redirect to VS Code (after sign in from CodeScene)
   * @param scopes
   * @returns
   */
  private handleUri(): PromiseAdapter<Uri, LoginResponse> {
    return async (uri, resolve, reject) => {
      const query = new URLSearchParams(uri.query);

      const name = query.get('name');
      const token = query.get('token');
      const userId = query.get('user-id');

      if (token === null) {
        Telemetry.logUsage('auth/rejected');
        reject('No token found in redirect');
        return;
      }

      if (name === null) {
        Telemetry.logUsage('auth/rejected');
        reject('No name found in redirect');
        return;
      }

      if (userId === null) {
        Telemetry.logUsage('auth/rejected');
        reject('No user-id found in redirect');
        return;
      }

      Telemetry.logUsage('auth/successful');
      resolve({ name, token, userId });
    };
  }
}
