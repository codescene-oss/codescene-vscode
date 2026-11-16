import vscode from 'vscode';
import { canReauthorize } from '../auth/auth-commands';
import type { AuthSnapshot } from '../auth/auth-payload';
import { logOutputChannel } from '../log';
import { setCwfObjectives } from './cwf-objectives';
import { ObjectivesService } from './objectives-service';
import type { ObjectivesTransport } from './objectives-transport';
import { GoalWorkSessionRpc } from './goal-work-session-rpc';
import { handleGoalWorkSessionStart } from './goal-work-session-messages';
import { handleFixGoal } from './fix-goal-messages';
import { registerObjectivesMessages } from '../code-health-monitor/home/cwf-message-handlers';
import { DevtoolsAPI } from '../devtools-api';

export interface ObjectivesFeature {
  disposables: vscode.Disposable[];
  update(snapshot: Pick<AuthSnapshot, 'active' | 'status' | 'syncing' | 'repo'>): void;
  startWorkSession(goalId: number): Promise<void>;
  fixGoal(goalId: number, path: string): Promise<void>;
}

export function activateObjectives(transport: ObjectivesTransport): ObjectivesFeature {
  const service = new ObjectivesService(transport);
  const rpc = new GoalWorkSessionRpc(transport);
  let reauthorizable = false;

  const startWorkSession = async (goalId: number) => {
    await handleGoalWorkSessionStart(goalId, {
      rpc,
      snapshot: () => service.findSnapshotWithGoal(goalId),
      capable: () => service.workSessionsCapable,
      canReauthorize: () => reauthorizable,
      notify: {
        warn: (message, ...actions) => vscode.window.showWarningMessage(message, ...actions),
        info: (message) => vscode.window.showInformationMessage(message).then(() => {}),
      },
      executeCommand: (id) => vscode.commands.executeCommand(id),
      log: (message) => logOutputChannel.info(message),
    });
  };

  const fixGoal = async (goalId: number, path: string) => {
    await handleFixGoal(goalId, path, {
      snapshot: () => service.findSnapshotWithGoal(goalId),
      enabled: () => DevtoolsAPI.aceEnabled(),
      openDocument: (p) => vscode.workspace.openTextDocument(vscode.Uri.file(p)),
      executeCommand: vscode.commands.executeCommand,
      log: logOutputChannel.info,
    });
  };

  const disposables: vscode.Disposable[] = [
    service,
    service.onDidChange(() => setCwfObjectives(service.current, { workSessions: service.workSessionsCapable })),
    registerObjectivesMessages({ startWorkSession, fixGoal }),
  ];
  void service.start().catch((error: unknown) => logOutputChannel.warn(`[objectives] start failed: ${String(error)}`));
  return {
    disposables,
    update: ({ active, status, syncing, repo }) => {
      reauthorizable = canReauthorize({ active, status });
      service.setContext({ active, settled: status?.state === 'signed-in' && !syncing, repoPath: repo?.path });
    },
    startWorkSession,
    fixGoal,
  };
}
