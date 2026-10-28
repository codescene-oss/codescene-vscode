import type { Event } from 'vscode';
import type { AuthStatus } from '../centralized-webview-framework/types/auth';
import type { ServerMetadata, ServerStartEvent } from '../devtools-api/ide-server-client';

export interface AuthTransport {
  start(): Promise<ServerMetadata>;
  restart(): Promise<ServerMetadata>;
  request<T>(method: string, params: unknown): Promise<T>;
  readonly onDidServerStart: Event<ServerStartEvent>;
  readonly onDidAuthStatusChange: Event<AuthStatus>;
}
