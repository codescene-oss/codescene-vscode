import type { ObjectivesSnapshot } from '../centralized-webview-framework/types/objectives';
import type { ObjectivesTransport } from './objectives-transport';

export class ObjectivesRpc {
  constructor(private readonly transport: Pick<ObjectivesTransport, 'request'>) {}

  snapshot(repoPath: string, refresh?: boolean): Promise<ObjectivesSnapshot> {
    return this.transport.request('cs-ide/objectives', {
      'repo-path': repoPath,
      ...(refresh === undefined ? {} : { refresh }),
    });
  }
}
