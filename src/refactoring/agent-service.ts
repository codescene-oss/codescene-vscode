import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { TextDocument } from 'vscode';
import { FnToRefactor, RefactorResponse, Confidence, Reason } from '../devtools-api/refactor-models';
import { logOutputChannel } from '../log';
import { buildAgentConfigWithToken } from './agent-config';
import { AgentInput, AgentOutput, ConfidenceLevel, AgentChange } from './agent-types';
import { getExtensionPath } from '../cs-extension-state';
import { getEffectiveToken } from '../devtools-api';
import { acquireGitApi, getRepoRootPath } from '../git-utils';

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

const INPUT_FILE = 'render-code-fix-input.json';
const OUTPUT_FILE = 'render-code-fix-output.json';

export type ProgressCallback = (message: string) => void;

export class AgentRefactoringService {
  private static getAgentBinaryPath(): string {
    const extensionPath = getExtensionPath();
    if (!extensionPath) {
      throw new Error('Extension path not available');
    }
    const binaryName = process.platform === 'win32' ? 'cs-agent.exe' : 'cs-agent';
    return path.join(extensionPath, 'bin', binaryName);
  }

  static async runRefactoring(
    document: TextDocument,
    fnToRefactor: FnToRefactor,
    signal?: AbortSignal,
    skipCleanup?: boolean,
    onProgress?: ProgressCallback
  ): Promise<RefactorResponse> {
    const taskId = `refactor-${uuidv4()}`;
    const gitApi = acquireGitApi();
    const repo = gitApi?.getRepository(document.uri);
    const workDir = repo ? getRepoRootPath(repo) : path.dirname(document.fileName);
    const inputPath = path.join(workDir, INPUT_FILE);
    const outputPath = path.join(workDir, OUTPUT_FILE);

    try {
      const input = AgentRefactoringService.buildInput(document, fnToRefactor, taskId);
      fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));

      logOutputChannel.info(`Agent refactoring started for task ${taskId}`);

      await AgentRefactoringService.invokeAgent(workDir, signal, onProgress);

      if (!fs.existsSync(outputPath)) {
        throw new Error('Agent did not produce output file');
      }

      const outputContent = fs.readFileSync(outputPath, 'utf-8');
      const output: AgentOutput = JSON.parse(outputContent);

      logOutputChannel.info(`Agent refactoring completed for task ${taskId}: ${output.fix_result}`);

      return AgentRefactoringService.mapOutputToResponse(output, document, fnToRefactor);
    } finally {
      if (!skipCleanup) {
        AgentRefactoringService.cleanup(inputPath, outputPath);
      }
    }
  }

  private static buildInput(document: TextDocument, fnToRefactor: FnToRefactor, taskId: string): AgentInput {
    const target = fnToRefactor['refactoring-targets'][0];
    if (!target) {
      throw new Error('No refactoring target found');
    }

    return {
      '@context': { '@vocab': 'https://codescene.io/schemas/code-health-fix#' },
      task_id: taskId,
      file: document.fileName,
      line: target.line,
      smell: target.category,
    };
  }

  private static invokeAgent(workDir: string, signal?: AbortSignal, onProgress?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      const binaryPath = AgentRefactoringService.getAgentBinaryPath();
      const token = getEffectiveToken();
      if (!token) {
        reject(new Error('No authentication token available for agent'));
        return;
      }
      const config = buildAgentConfigWithToken(token);
      const configJson = JSON.stringify(config);

      const args: string[] = ['run', 'skill:render-code-fix', '--model', 'amazon-bedrock/eu.anthropic.claude-sonnet-4-6'];
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CS_AGENT_CONFIG: configJson,
      };

      logOutputChannel.debug(`Spawning agent: ${binaryPath} ${args.join(' ')}`);

      const proc: ChildProcess = spawn(binaryPath, args, {
        cwd: workDir,
        env,
      });

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        const lines = data.toString().split('\n').filter((line) => line.trim());
        for (const line of lines) {
          logOutputChannel.debug(`[cs-agent:err] ${stripAnsi(line)}`);
        }
      });

      proc.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        logOutputChannel.debug(`Agent stdout: ${output}`);
        if (onProgress) {
          const lines = output.split('\n').filter((line) => line.trim());
          if (lines.length > 0) {
            onProgress(lines[lines.length - 1]);
          }
        }
      });

      const abortHandler = () => {
        proc.kill('SIGTERM');
        reject(new Error('Agent invocation aborted'));
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler);
      }

      proc.on('close', (code: number | null) => {
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }

        if (code === 0) {
          resolve();
        } else {
          logOutputChannel.error(`Agent exited with code ${code}: ${stderr}`);
          reject(new Error(`Agent exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err: Error) => {
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }
        reject(err);
      });
    });
  }

  static mapOutputToResponse(
    output: AgentOutput,
    document: TextDocument,
    fnToRefactor: FnToRefactor
  ): RefactorResponse {
    const code = AgentRefactoringService.applyChanges(document, fnToRefactor, output.changes);
    const confidence = AgentRefactoringService.mapConfidence(output);
    const reasons = AgentRefactoringService.mapReasons(output);

    return {
      code,
      confidence,
      'credits-info': undefined,
      declarations: undefined,
      metadata: { 'cached?': false },
      reasons,
      'refactoring-properties': {
        'added-code-smells': [],
        'removed-code-smells': fnToRefactor['refactoring-targets'].map((t) => t.category),
      },
      'trace-id': output.task_id,
    };
  }

  private static applyChanges(
    document: TextDocument,
    fnToRefactor: FnToRefactor,
    changes: AgentChange[]
  ): string {
    let code = fnToRefactor.body;

    for (const change of changes) {
      if (path.basename(change.file) !== path.basename(document.fileName)) {
        continue;
      }

      if (change.change_type === 'whole_file' && change.whole_file_content) {
        code = change.whole_file_content;
      } else if (change.replacements) {
        for (const replacement of change.replacements) {
          code = code.replace(replacement.search, replacement.replace);
        }
      }
    }

    return code;
  }

  private static mapConfidence(output: AgentOutput): Confidence {
    const levelMap: Record<ConfidenceLevel, number> = {
      high: 3,
      medium: 2,
      low: 1,
    };

    let title: string;
    let description: string;

    switch (output.fix_result) {
      case 'fix_proposed':
        title = output.summary;
        description = 'Review the suggested changes and apply if appropriate.';
        break;
      case 'unable_to_fix':
        title = 'Unable to refactor';
        description = 'The agent could not find a suitable refactoring for this code.';
        break;
      case 'needs_human_review':
        title = 'Needs review';
        description = 'The suggested changes require careful human review before applying.';
        break;
    }

    return {
      level: levelMap[output.confidence] ?? 2,
      title,
      'review-header': output.fix_result === 'fix_proposed' ? undefined : 'Review required',
      'recommended-action': {
        description,
        details: output.reasoning,
      },
    };
  }

  private static mapReasons(output: AgentOutput): Reason[] {
    if (output.fix_result === 'fix_proposed') {
      return [];
    }

    return [
      {
        summary: output.summary,
        details: undefined,
      },
    ];
  }

  private static cleanup(inputPath: string, outputPath: string): void {
    for (const filePath of [inputPath, outputPath]) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        logOutputChannel.warn(`Failed to cleanup file ${filePath}: ${err}`);
      }
    }
  }
}
