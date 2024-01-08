import {
  authentication,
  AuthenticationProvider,
  AuthenticationProviderAuthenticationSessionsChangeEvent,
  AuthenticationSession,
  Disposable,
  env,
  EventEmitter,
  ExtensionContext,
  ProgressLocation,
  Uri,
  UriHandler,
  window,
} from 'vscode';
import { v4 as uuid } from 'uuid';
import { PromiseAdapter, promiseFromEvent } from './util';
import { outputChannel } from '../log';
import { getServerUrl } from '../configuration';
import { CsWorkspace } from '../workspace';

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
}

export class CsAuthenticationProvider implements AuthenticationProvider, Disposable {
  private sessionChangeEmitter = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
  private disposable: Disposable;
  private uriHandler = new UriEventHandler();

  constructor(private context: ExtensionContext, private csWorkspace: CsWorkspace) {
    this.disposable = Disposable.from(
      authentication.registerAuthenticationProvider(AUTH_TYPE, "CodeScene Cloud", this, { supportsMultipleAccounts: false }),
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
      return JSON.parse(allSessions) as AuthenticationSession[];
    }

    return [];
  }

  /**
   * Create a new auth session
   * @param scopes
   * @returns
   */
  public async createSession(scopes: string[]): Promise<AuthenticationSession> {
    try {
      const loginResponse = await this.login();

      if (!loginResponse) {
        throw new Error("CodeScene login failure");
      }

      const session: AuthenticationSession = {
        id: uuid(), // Do we need a "static" id here?
        accessToken: loginResponse.token,
        account: {
          label: loginResponse.name,
          id: uuid(), // Do we need a "static" id here?
        },
        scopes: [],
      };

      await this.context.secrets.store(SESSIONS_STORAGE_KEY, JSON.stringify([session]));

      this.sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });

      outputChannel.appendLine(`Created session ${session.id} for ${session.account.label}`);

      if (this.csWorkspace.getProjectId() === undefined) {
       const result = await window.showInformationMessage(`Signed in to CodeScene as ${session.account.label}`, "Associate workspace with project");
       if (result === "Associate workspace with project") {
         this.csWorkspace.associateWithProject();
       }
      } else {
        window.showInformationMessage(`Signed in to CodeScene as ${session.account.label}`);
      }

      return session;
    } catch (e) {
      window.showErrorMessage(`Sign in failed: ${e}`);
      throw e;
    }
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
        await this.context.secrets.store(SESSIONS_STORAGE_KEY, "[]");
        this.sessionChangeEmitter.fire({ added: [], removed: [session], changed: [] });
        this.csWorkspace.clearProjectAssociation();
      }
    }
  }

  /**
   * Dispose the registered services
   */
  public async dispose() {
    this.disposable.dispose();
  }

  /**
   * Log in to CodeScene
   */
  private async login() {
    return await window.withProgress<LoginResponse>(
      {
        location: ProgressLocation.Notification,
        title: 'Signing in to CodeScene...',
        cancellable: true,
      },
      async (_, cancel) => {
        const tokenParams = new URLSearchParams({
          next: `configuration/devtools-tokens/add/vscode`,
        });
        const loginUrl = Uri.parse(`${getServerUrl()}/login?${tokenParams.toString()}`);
        outputChannel.appendLine(`Opening ${loginUrl.toString()}`);

        await env.openExternal(loginUrl);

        let codeExchangePromise = promiseFromEvent(this.uriHandler.event, this.handleUri());

        try {
          return await Promise.race([
            codeExchangePromise.promise,
            new Promise<LoginResponse>((_, reject) => setTimeout(() => reject('Cancelled'), 60000)),
            promiseFromEvent<any, any>(cancel.onCancellationRequested, (_, __, reject) => {
              reject('User Cancelled');
            }).promise,
          ]);
        } finally {
          codeExchangePromise?.cancel.fire();
        }
      }
    );
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

      if (token === null) {
        reject('No token found in redirect');
        return;
      }

      if (name === null) {
        reject('No name found in redirect');
        return;
      }

      resolve({ name, token});
    };
  }
}
