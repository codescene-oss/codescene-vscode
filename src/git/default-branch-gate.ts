import { Repository } from '../../types/git';
import { getDefaultBranch } from '../git-utils';

export class DefaultBranchGate {
  private repoPath: string;
  private cachedDefaultBranch: string | undefined = undefined;
  private hasFetched: boolean = false;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  private async fetchDefaultBranch(): Promise<string | undefined> {
    if (!this.hasFetched) {
      this.cachedDefaultBranch = await getDefaultBranch(this.repoPath);
      this.hasFetched = true;
    }
    return this.cachedDefaultBranch;
  }

  async shouldSkipBasedOnDefaultBranch(repo: Repository): Promise<boolean> {
    const currentBranch = repo.state.HEAD?.name;

    if (!currentBranch) {
      return false;
    }

    const defaultBranch = await this.fetchDefaultBranch();

    if (!defaultBranch) {
      return false;
    }

    return currentBranch.localeCompare(defaultBranch, undefined, { sensitivity: 'accent' }) === 0;
  }
}
