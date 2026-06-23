import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { logOutputChannel } from '../log';
import { getEffectiveToken } from '../devtools-api';
import { CodeSmell } from '../devtools-api/review-model';

/**
 * Strips ANSI escape codes from a string.
 * ANSI codes are used for terminal colors and formatting.
 */
function stripAnsi(str: string): string {
  // Regex pattern that matches all ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Configuration for the refactoring agent binary.
 * Uses Amazon Bedrock for LLM inference.
 */
interface RefactoringAgentConfig {
  codescene_access_token: string;
  opencode_config: {
    provider: {
      'amazon-bedrock': {
        options: {
          profile: string;
          region: string;
        };
      };
    };
  };
}

/**
 * Parameters for running the refactoring agent.
 */
export interface RefactoringParams {
  /** Absolute path to the file to refactor */
  filePath: string;
  /** 1-indexed line number where the code smell is located */
  line: number;
  /** The type of code smell to fix (e.g., "Complex Method", "Large Method") */
  smell: string;
}

/**
 * Result of running the refactoring agent.
 */
export interface RefactoringResult {
  /** Whether the refactoring completed successfully */
  success: boolean;
  /** Whether any changes were made to the file */
  hasChanges: boolean;
  /** Error message if the refactoring failed */
  error?: string;
}

/**
 * Gets the path to the refactoring-agent binary bundled with the extension.
 */
function getRefactoringAgentBinaryPath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, 'bin', 'refactoring-agent');
}

/**
 * Builds the CS_AGENT_CONFIG environment variable JSON.
 */
function buildAgentConfig(token: string): RefactoringAgentConfig {
  return {
    codescene_access_token: token,
    opencode_config: {
      provider: {
        'amazon-bedrock': {
          options: {
            // TEMPORARY: Hardcoded AWS credentials for development
            // TODO: Make these configurable via extension settings
            profile: 'codescene-dev',
            region: 'eu-west-1',
          },
        },
      },
    },
  };
}

/**
 * Builds the command string for the refactoring agent.
 */
function buildCommandString(params: RefactoringParams): string {
  return `skill:fix-specific-health-issue file:${params.filePath} line:${params.line} smell:"${params.smell}"`;
}

/**
 * Runs the refactoring agent binary to fix a specific code health issue.
 *
 * The agent will:
 * - Stream logs to stdout (forwarded to VS Code debug output)
 * - Write changes directly to the file
 *
 * @param context - VS Code extension context
 * @param params - Parameters for the refactoring
 * @param cancellationToken - Optional cancellation token
 * @returns Result indicating success and whether changes were made
 */
export async function runRefactoringAgent(
  context: vscode.ExtensionContext,
  params: RefactoringParams,
  cancellationToken?: vscode.CancellationToken
): Promise<RefactoringResult> {
  const token = getEffectiveToken();
  if (!token) {
    return {
      success: false,
      hasChanges: false,
      error: 'No authentication token available. Please sign in to CodeScene.',
    };
  }

  const binaryPath = getRefactoringAgentBinaryPath(context);
  const config = buildAgentConfig(token);
  const commandString = buildCommandString(params);

  const args = [
    'run',
    commandString,
    '--model',
    'amazon-bedrock/eu.anthropic.claude-sonnet-4-6',
  ];

  const configJson = JSON.stringify(config);

  logOutputChannel.info(`Starting refactoring agent for ${params.filePath}:${params.line} (${params.smell})`);
  logOutputChannel.debug(`Refactoring agent command: CS_AGENT_CONFIG=${configJson} ${binaryPath} ${args.join(' ')}`);

  return new Promise<RefactoringResult>((resolve) => {
    const cwd = path.dirname(params.filePath);

    const childProcess: ChildProcess = spawn(binaryPath, args, {
      cwd,
      env: {
        ...process.env,
        CS_AGENT_CONFIG: configJson,
      },
    });

    let stderr = '';

    // Handle cancellation
    const cancellationListener = cancellationToken?.onCancellationRequested(() => {
      logOutputChannel.info('Refactoring agent cancelled by user');
      childProcess.kill('SIGTERM');
    });

    // Stream stdout to debug log
    childProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter((line) => line.trim());
      for (const line of lines) {
        logOutputChannel.debug(`[refactoring-agent] ${stripAnsi(line)}`);
      }
    });

    // Capture stderr
    childProcess.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
      const lines = data.toString().split('\n').filter((line) => line.trim());
      for (const line of lines) {
        logOutputChannel.debug(`[refactoring-agent:err] ${stripAnsi(line)}`);
      }
    });

    childProcess.on('error', (error) => {
      cancellationListener?.dispose();
      logOutputChannel.error(`Refactoring agent failed to start: ${error.message}`);
      resolve({
        success: false,
        hasChanges: false,
        error: `Failed to start refactoring agent: ${error.message}`,
      });
    });

    childProcess.on('close', (code) => {
      cancellationListener?.dispose();

      if (code === 0) {
        logOutputChannel.info('Refactoring agent completed successfully');
        resolve({
          success: true,
          hasChanges: true, // We'll verify this with git diff in the caller
        });
      } else if (cancellationToken?.isCancellationRequested) {
        resolve({
          success: false,
          hasChanges: false,
          error: 'Refactoring was cancelled',
        });
      } else {
        const errorMsg = stderr.trim() || `Process exited with code ${code}`;
        logOutputChannel.error(`Refactoring agent failed: ${errorMsg}`);
        resolve({
          success: false,
          hasChanges: false,
          error: errorMsg,
        });
      }
    });
  });
}

/**
 * Gets the modification timestamp of a file.
 * Returns the timestamp in milliseconds since epoch.
 * Returns null if the file doesn't exist or an error occurs.
 */
export async function getFileTimestamp(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    fs.stat(filePath, (err, stats) => {
      if (err) {
        logOutputChannel.debug(`Failed to get timestamp for ${filePath}: ${err.message}`);
        resolve(null);
      } else {
        resolve(stats.mtimeMs);
      }
    });
  });
}

/**
 * Checks if the file has uncommitted changes using git.
 * Returns the diff output if there are changes.
 */
export async function getGitDiff(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const cwd = path.dirname(filePath);
    const fileName = path.basename(filePath);

    const gitProcess = spawn('git', ['diff', '--', fileName], { cwd });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    gitProcess.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout);
      } else {
        resolve(null);
      }
    });

    gitProcess.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Opens a diff view in VS Code showing the changes made to a file.
 * Compares the current working tree version against HEAD.
 */
export async function showGitDiffView(filePath: string): Promise<void> {
  const fileName = path.basename(filePath);
  const fileUri = vscode.Uri.file(filePath);

  // Create git URI with proper scheme and query parameters
  // Query must be JSON-stringified object with 'path' and 'ref' properties
  const headUri = fileUri.with({
    scheme: 'git',
    query: JSON.stringify({ path: filePath, ref: 'HEAD' })
  });
  const workingUri = fileUri;

  await vscode.commands.executeCommand(
    'vscode.diff',
    headUri,
    workingUri,
    `Refactoring Changes: ${fileName}`
  );
}

/**
 * Converts a CodeSmell to RefactoringParams.
 */
export function codeSmellToRefactoringParams(
  document: vscode.TextDocument,
  codeSmell: CodeSmell
): RefactoringParams {
  return {
    filePath: document.uri.fsPath,
    line: codeSmell['highlight-range']['start-line'],
    smell: codeSmell.category,
  };
}
