import vscode from 'vscode';
import type { AuthSnapshot } from '../auth/auth-payload';
import { logOutputChannel } from '../log';
import { setCwfObjectives } from './cwf-objectives';
import { ObjectivesService } from './objectives-service';
import type { ObjectivesTransport } from './objectives-transport';

export interface ObjectivesFeature {
  disposables: vscode.Disposable[];
  update(snapshot: Pick<AuthSnapshot, 'active' | 'status' | 'syncing' | 'repo'>): void;
}

export function activateObjectives(transport: ObjectivesTransport): ObjectivesFeature {
  const service = new ObjectivesService(transport);
  const disposables: vscode.Disposable[] = [
    service,
    service.onDidChange(() => setCwfObjectives(service.current, { workSessions: service.workSessionsCapable })),
  ];
  void service.start().catch((error: unknown) => logOutputChannel.warn(`[objectives] start failed: ${String(error)}`));
  return {
    disposables,
    update: ({ active, status, syncing, repo }) =>
      service.setContext({ active, settled: status?.state === 'signed-in' && !syncing, repoPath: repo?.path }),
  };
}
