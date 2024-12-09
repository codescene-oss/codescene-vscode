import { ExecOptions } from 'child_process';
import { CodeHealthRulesResult, EnclosingFn } from './model';
import { Command, SimpleExecutor } from '../executor';
import { CsExtensionState } from '../cs-extension-state';
import { isError } from '../utils';

export class DevtoolsAPI {
  private executor: SimpleExecutor = new SimpleExecutor();
  constructor(private binaryPath: string) {}

  private execute(args: string[], options = {}, input?: string) {
    const command: Command = {
      command: this.binaryPath,
      args,
    };
    return this.executor.execute(command, options, input).then(
      (result) => result,
      (e) => {
        if (isError(e)) {
          CsExtensionState.setAnalysisState({ error: e, state: 'error' });
        }
        throw e;
      }
    );
  }

  private async executeAsString(args: string[], options?: ExecOptions, input?: string) {
    const result = await this.execute(args, options, input);
    return result.stdout.trim();
  }

  private async executeAsJson<T>(args: string[], options?: ExecOptions, input?: string) {
    const result = await this.execute(args, options, input);
    return JSON.parse(result.stdout) as T;
  }

  /**
   * Executes the command for creating a code health rules template.
   */
  codeHealthRulesTemplate() {
    return this.executeAsString(['code-health-rules-template']);
  }

  /**
   * Executes the command for checking code health rule match against file
   */
  async checkRules(rootPath: string, filePath: string) {
    const { stdout, stderr } = await this.execute(['check-rules', filePath], { cwd: rootPath });
    const err = stderr.trim();
    return { rulesMsg: stdout.trim(), errorMsg: err !== '' ? err : undefined } as CodeHealthRulesResult;
  }

  /**
   * Executes the command for getting function coordinates for a list of line numbers.
   * This command will only return distinct functions, even if several line numbers point to the same function.
   */
  async enclosingFunctions(fileName: string, lineNos: number[], payload: string) {
    if (lineNos.length === 0) return [];

    try {
      return await this.executeAsJson<EnclosingFn[]>(
        ['enclosing-functions', '--file-name', fileName, '--line-no', lineNos.join(',')],
        {},
        payload
      );
    } catch (e) {
      return [];
    }
  }

  /**
   * Executes the command for signing a payload.
   */
  sign(payload: string) {
    return this.executeAsString(['sign'], {}, payload);
  }
}
