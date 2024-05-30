/* eslint-disable @typescript-eslint/naming-convention */
import { CsExtensionState } from './cs-extension-state';
import { ExecResult, SimpleExecutor } from './executor';

/**
 * Executes the command for creating a code health rules template.
 */
export function codeHealthRulesJson() {
  return new SimpleExecutor().execute({ command: CsExtensionState.cliPath, args: ['code-health-rules-template'] });
}

/**
 * Executes the command for checking code health rule match against file
 */
export function codeHealthRulesCheck(rootPath: string, filePath: string) {
  return new SimpleExecutor().execute(
    { command: CsExtensionState.cliPath, args: ['check-rules', filePath] },
    { cwd: rootPath }
  );
}

/**
 * Executes the command for signing a payload.
 */
export function sign(payload: string) {
  return new SimpleExecutor().execute({ command: CsExtensionState.cliPath, args: ['sign'] }, {}, payload);
}

export interface EnclosingFn {
  name: string;
  'start-line': number;
  'end-line': number;
  body: string;
  'function-type': string;
  'start-column': number;
  'end-column': number;
  'active-code-size': number;
}
/**
 * Executes the command for getting function coordinates for a list of line numbers.
 * This command will only return distinct functions, even if several line numbers point to the same function.
 */
export async function findEnclosingFunctions(extension: string, lineNos: number[], payload: string) {
  if (lineNos.length === 0) return [];
  const result: ExecResult = await new SimpleExecutor().execute(
    {
      command: CsExtensionState.cliPath,
      args: [
        'enclosing-functions',
        '--file-type',
        extension,
        '--output-format',
        'json',
        '--line-no',
        lineNos.join(','),
      ],
    },
    {},
    payload
  );
  return JSON.parse(result.stdout) as EnclosingFn[];
}
