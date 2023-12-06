import { SimpleExecutor } from './executor';

/**
 * Executes the command for creating a code health rules template.
 */
export function codeHealthRulesJson(cliPath: string) {
  return new SimpleExecutor().execute({ command: cliPath, args: ['code-health-rules-template'] });
}

/**
 * Executes the command for signing a payload.
 */
export async function sign(cliPath: string, payload: string) {
  return new SimpleExecutor().execute({ command: cliPath, args: ['sign'] }, {}, payload);
}
