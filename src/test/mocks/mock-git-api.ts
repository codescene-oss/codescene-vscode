import { API } from '../../../types/git';

export class MockGitAPI implements Partial<API> {
  repositories: any[] = [];

  getRepository(uri: any) {
    const fsPath = uri.fsPath || uri.path || '';
    return this.repositories.find((repo) => fsPath.startsWith(repo.rootUri.fsPath)) || null;
  }
}
