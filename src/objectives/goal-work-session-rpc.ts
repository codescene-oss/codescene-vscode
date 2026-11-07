import type { ObjectivesTransport } from './objectives-transport';

export type GoalWorkSessionStartResult =
  | { result: 'started' }
  | { result: 'unavailable' }
  | { result: 'goal-inactive' }
  | { result: 'parent-inactive' }
  | { result: 'network' }
  | { result: 'scope-missing' }
  | { result: 'signed-out' };

export class GoalWorkSessionRpc {
  constructor(private readonly transport: Pick<ObjectivesTransport, 'request'>) {}

  start(repoPath: string, goalId: number): Promise<GoalWorkSessionStartResult> {
    return this.transport.request('cs-ide/goalWorkSessionStart', {
      'repo-path': repoPath,
      'goal-id': goalId,
    });
  }
}
