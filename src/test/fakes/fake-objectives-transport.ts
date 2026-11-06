import { EventEmitter } from 'vscode';
import type { ObjectivesSnapshot } from '../../centralized-webview-framework/types/objectives';
import type { ServerMetadata, ServerStartEvent } from '../../devtools-api/ide-server-client';
import type { ObjectivesTransport } from '../../objectives/objectives-transport';

export interface RecordedObjectivesRequest {
  method: string;
  params: unknown;
}

export class FakeObjectivesTransport implements ObjectivesTransport {
  readonly requests: RecordedObjectivesRequest[] = [];
  private readonly startEmitter = new EventEmitter<ServerStartEvent>();
  private readonly objectivesEmitter = new EventEmitter<ObjectivesSnapshot>();
  private failure: Error | undefined;
  readonly onDidServerStart = this.startEmitter.event;
  readonly onDidObjectivesChange = this.objectivesEmitter.event;

  constructor(
    private metadata: ServerMetadata,
    private readonly answer: (repoPath: string) => ObjectivesSnapshot
  ) {}

  start(): Promise<ServerMetadata> {
    return Promise.resolve(this.metadata);
  }

  failRequests(error: Error): void {
    this.failure = error;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    this.requests.push({ method, params });
    if (this.failure) throw this.failure;
    return this.answer((params as { 'repo-path': string })['repo-path']) as T;
  }

  emitRestart(metadata: ServerMetadata = this.metadata): void {
    this.metadata = metadata;
    this.startEmitter.fire({ metadata, restart: true });
  }

  notify(snapshot: ObjectivesSnapshot): void {
    this.objectivesEmitter.fire(snapshot);
  }
}
