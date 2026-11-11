import type { Event } from 'vscode';
import type { ObjectivesSnapshot } from '../centralized-webview-framework/types/objectives';
import type { ServerMetadata, ServerStartEvent } from '../devtools-api/ide-server-client';

export interface ObjectivesTransport {
  start(): Promise<ServerMetadata>;
  request<T>(method: string, params: unknown): Promise<T>;
  readonly onDidServerStart: Event<ServerStartEvent>;
  readonly onDidObjectivesChange: Event<ObjectivesSnapshot>;
}
