import vscode from 'vscode';
import { RefactoringRequest } from './request';
import Telemetry from '../telemetry';
import { acquireGitApi, getRepoRootPath } from '../git-utils';
import { AgentTimeoutError } from './agent-process';
import { MissingAuthTokenError } from '../missing-auth-token-error';
import { DevtoolsError } from '../devtools-api/devtools-error';
import { DevtoolsAPI } from '../devtools-api';

export function aiFeature(request: RefactoringRequest): string {
  return request.goal ? 'fix-task' : 'refactor';
}

export function logAiStage(request: RefactoringRequest, stage: string, extra?: any): void {
  const feature = aiFeature(request);
  let root: string | undefined;

  if (request.goal) {
    root = request.goal.repoRoot;
  } else {
    const repo = acquireGitApi()?.getRepository(request.document.uri);
    if (repo) {
      root = getRepoRootPath(repo);
    }
  }

  Telemetry.logUsage(`ai/${feature}/${stage}`, {
    ...request.eventData,
    ...extra,
    'repository-paths': new vscode.TelemetryTrustedValue(root ? [root] : []),
  });
}

export function failureReason(error: unknown): string {
  if (error instanceof AgentTimeoutError) {
    return 'timeout';
  }

  if (error instanceof MissingAuthTokenError) {
    return 'auth';
  }

  if (error instanceof DevtoolsError) {
    const status = (error as any).status;
    if (status === 401 || status === 403) {
      return 'auth';
    }
  }

  if (DevtoolsAPI.isOfflineError(error)) {
    return 'offline';
  }

  return 'agent-error';
}

export function logPanelStage(request: RefactoringRequest, stage: 'presented' | 'diff-shown' | 'copied' | 'applied' | 'discarded'): void {
  logAiStage(request, stage);
}
