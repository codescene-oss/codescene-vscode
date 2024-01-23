/* eslint-disable @typescript-eslint/naming-convention */
import { window } from 'vscode';
import { ExecResult, SimpleExecutor } from './executor';

/**
 * Executes the command for creating a code health rules template.
 */
export function codeHealthRulesJson(cliPath: string) {
  return new SimpleExecutor().execute({ command: cliPath, args: ['code-health-rules-template'] });
}

/**
 * Executes the command for signing a payload.
 */
export function sign(cliPath: string, payload: string) {
  return new SimpleExecutor().execute({ command: cliPath, args: ['sign'] }, {}, payload);
}

interface EnclosingFn {
  name: string;
  'start-line': number;
  'end-line': number;
  body: string;
  'function-type': string;
  'start-column': number;
  'end-column': number;
}
/**
 * Executes the command for getting a function coordinate.
 */
export async function findEnclosingFunction(cliPath: string, extension: string, lineNo: number, payload: string) {
  const result: ExecResult = await new SimpleExecutor().execute(
    {
      command: cliPath,
      args: ['enclosing-function', '--file-type', extension, '--output-format', 'json', '--line-no', lineNo.toString()],
    },
    {},
    payload
  );
  return JSON.parse(result.stdout) as EnclosingFn;
}
