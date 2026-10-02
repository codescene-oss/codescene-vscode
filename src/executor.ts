import { ExecOptions } from 'child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | string;
  duration: number;
}

export interface Command {
  command: string;
  args: string[];
  /** Don't reject the promise on error */
  ignoreError?: boolean;
}

export interface Executor {
  execute(command: Command, options: ExecOptions, input?: string): Promise<ExecResult>;
}

/**
 * Executes a process and returns its output.
 *
 * Optionally, it can also write to the process' stdin.
 */

export interface Task extends Command {
  taskId: string;
}
