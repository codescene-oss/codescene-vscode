import { EventEmitter } from 'vscode';
import type { ObjectivesSnapshot } from '../../centralized-webview-framework/types/objectives';
import type { ServerMetadata, ServerStartEvent } from '../../devtools-api/ide-server-client';
import type { ObjectivesTransport } from '../../objectives/objectives-transport';
import type { GoalWorkSessionStartResult } from '../../objectives/goal-work-session-rpc';

export interface RecordedObjectivesRequest {
  method: string;
  params: unknown;
}

export class FakeObjectivesTransport implements ObjectivesTransport {
  readonly requests: RecordedObjectivesRequest[] = [];
  private readonly startEmitter = new EventEmitter<ServerStartEvent>();
  private readonly objectivesEmitter = new EventEmitter<ObjectivesSnapshot>();
  private failure: Error | undefined;
  private workSessionStartResult: GoalWorkSessionStartResult | undefined;
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

  setWorkSessionStartResult(result: GoalWorkSessionStartResult): void {
    this.workSessionStartResult = result;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    this.requests.push({ method, params });
    if (this.failure) throw this.failure;

    if (method === 'cs-ide/goalWorkSessionStart') {
      if (!this.workSessionStartResult) {
        throw new Error('Work session start result not configured');
      }
      return this.workSessionStartResult as T;
    }

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
