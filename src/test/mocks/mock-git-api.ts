import { API } from '../../../types/git';

export class MockGitAPI implements Partial<API> {
  repositories: any[] = [];
}
