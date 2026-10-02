import { Executor } from '../../executor';

export class MockExecutor implements Executor {
  async execute(): Promise<any> {
    return { stdout: '', stderr: '', exitCode: 0, duration: 0 };
  }
}
