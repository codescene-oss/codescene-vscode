import { isDeepStrictEqual } from 'util';
import vscode from 'vscode';
import type { ObjectivesSnapshot } from '../centralized-webview-framework/types/objectives';
import type { ServerMetadata } from '../devtools-api/ide-server-client';
import { logOutputChannel } from '../log';
import { normalizeFsPath } from '../utils/fs-paths';
import { ObjectivesRpc } from './objectives-rpc';
import type { ObjectivesTransport } from './objectives-transport';

export const OBJECTIVES_CAPABILITY = 'objectives-v1';

export interface ObjectivesContext {
  active: boolean;
  settled: boolean;
  repoPath: string | undefined;
}

export class ObjectivesService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly snapshots = new Map<string, ObjectivesSnapshot>();
  private capable = false;
  private serverEpoch = 0;
  private hasSettled = false;
  private context: ObjectivesContext = { active: false, settled: false, repoPath: undefined };
  readonly onDidChange = this.emitter.event;

  private readonly rpc: ObjectivesRpc;

  constructor(private readonly transport: ObjectivesTransport) {
    this.rpc = new ObjectivesRpc(transport);
  }

  get current(): ObjectivesSnapshot | undefined {
    const repoPath = this.servableRepo(this.hasSettled);
    return repoPath ? this.snapshots.get(normalizeFsPath(repoPath)) : undefined;
  }

  async start(): Promise<void> {
    this.disposables.push(
      this.transport.onDidServerStart((event) => this.handleServerStart(event.metadata)),
      this.transport.onDidObjectivesChange((snapshot) => this.store(snapshot))
    );
    this.handleServerStart(await this.transport.start());
  }

  setContext(context: ObjectivesContext): void {
    const before = this.current;
    const reload = this.needsLoad(context);
    this.context = context;
    this.hasSettled ||= context.settled;
    if (reload) void this.load();
    this.fireIfChanged(before);
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.emitter.dispose();
  }

  private servableRepo(settled: boolean): string | undefined {
    const { active, repoPath } = this.context;
    return active && this.capable && settled ? repoPath : undefined;
  }

  private needsLoad(next: ObjectivesContext): boolean {
    if (!next.settled || !next.repoPath) return false;
    const { settled, repoPath } = this.context;
    return !settled || repoPath === undefined || normalizeFsPath(repoPath) !== normalizeFsPath(next.repoPath);
  }

  private handleServerStart(metadata: ServerMetadata): void {
    const before = this.current;
    this.capable = metadata.capabilities?.includes(OBJECTIVES_CAPABILITY) === true;
    this.serverEpoch++;
    this.hasSettled = this.context.settled;
    this.snapshots.clear();
    void this.load();
    this.fireIfChanged(before);
  }

  private store(snapshot: ObjectivesSnapshot): void {
    const before = this.current;
    this.snapshots.set(normalizeFsPath(snapshot['repo-root']), snapshot);
    this.fireIfChanged(before);
  }

  private fireIfChanged(before: ObjectivesSnapshot | undefined): void {
    if (!isDeepStrictEqual(before, this.current)) this.emitter.fire();
  }

  private async load(): Promise<void> {
    const repoPath = this.servableRepo(this.context.settled);
    if (!repoPath) return;
    const epoch = this.serverEpoch;
    try {
      const snapshot = await this.rpc.snapshot(repoPath);
      logOutputChannel.info(`[objectives] requested snapshot repo=${snapshot['repo-root']} state=${snapshot.state} count=${snapshot.objectives.length}`);
      if (epoch === this.serverEpoch) this.store(snapshot);
    } catch (error) {
      logOutputChannel.warn(`[objectives] request failed: ${String(error)}`);
    }
  }
}
