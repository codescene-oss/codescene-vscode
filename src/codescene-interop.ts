import { SimpleExecutor } from './executor';

/**
 * Executes the command for creating a code health rules template, and returns the result as a string.
 */
export function codeHealthRulesJson(cliPath: string) {
  return new SimpleExecutor().execute({ command: cliPath, args: ['help', 'code-health-rules-template'] });
}

/**
 * Executes the command for signing a payload, and returns the resulting signature as a string.
 */
export async function sign(cliPath: string, payload: string) {
  return new SimpleExecutor().execute({ command: cliPath, args: ['sign'] }, {}, payload);
}
