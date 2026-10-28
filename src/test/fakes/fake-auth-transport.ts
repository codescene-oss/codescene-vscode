import { EventEmitter } from 'vscode';
import type { AuthTransport } from '../../auth/auth-transport';
import type { AuthErrorCode, AuthStatus } from '../../centralized-webview-framework/types/auth';
import type { ServerMetadata, ServerStartEvent } from '../../devtools-api/ide-server-client';

type Handler = (params: Record<string, unknown>) => unknown;

export interface RecordedRequest {
  method: string;
  params: unknown;
}

export class FakeAuthTransport implements AuthTransport {
  readonly requests: RecordedRequest[] = [];
  restarts = 0;
  private startError: Error | undefined;
  private readonly handlers = new Map<string, Handler>();
  private readonly startEmitter = new EventEmitter<ServerStartEvent>();
  private readonly statusEmitter = new EventEmitter<AuthStatus>();
  readonly onDidServerStart = this.startEmitter.event;
  readonly onDidAuthStatusChange = this.statusEmitter.event;

  constructor(private metadata: ServerMetadata = { sha: 'sha', version: 'version', capabilities: ['auth-v1'] }) {}

  start(): Promise<ServerMetadata> {
    if (this.startError) return Promise.reject(this.startError);
    return Promise.resolve(this.metadata);
  }

  failStart(error: Error): this {
    this.startError = error;
    return this;
  }

  emitStart(metadata: ServerMetadata = this.metadata): void {
    this.metadata = metadata;
    this.startEmitter.fire({ metadata, restart: false });
  }

  respond(method: string, handler: Handler): this {
    this.handlers.set(method, handler);
    return this;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    this.requests.push({ method, params });
    const handler = this.handlers.get(method);
    if (!handler) throw new Error(`No fake response for ${method}`);
    return (await handler(params as Record<string, unknown>)) as T;
  }

  methods(): string[] {
    return this.requests.map((request) => request.method);
  }

  restart(): Promise<ServerMetadata> {
    this.restarts++;
    this.emitRestart();
    return Promise.resolve(this.metadata);
  }

  emitRestart(metadata: ServerMetadata = this.metadata): void {
    this.metadata = metadata;
    this.startEmitter.fire({ metadata, restart: true });
  }

  notify(status: AuthStatus): void {
    this.statusEmitter.fire(status);
  }
}

export function authRpcError(code: AuthErrorCode, message: string = code): Error {
  return Object.assign(new Error(message), { code: -32803, data: { code } });
}

export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
