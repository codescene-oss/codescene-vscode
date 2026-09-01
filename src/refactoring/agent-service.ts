import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { TextDocument } from 'vscode';
import { FnToRefactor, RefactorResponse, Confidence, Reason } from '../devtools-api/refactor-models';
import { logOutputChannel } from '../log';
import { buildAgentConfigWithToken } from './agent-config';
import { AgentInput, AgentOutput, ConfidenceLevel, AgentChange } from './agent-types';
import { getExtensionPath } from '../cs-extension-state';
import { getEffectiveToken } from '../devtools-api';

const INPUT_FILE = 'render-code-fix-input.json';
const OUTPUT_FILE = 'render-code-fix-output.json';

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
    signal?: AbortSignal
  ): Promise<RefactorResponse> {
    const taskId = `refactor-${uuidv4()}`;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-agent-'));
    const inputPath = path.join(workDir, INPUT_FILE);
    const outputPath = path.join(workDir, OUTPUT_FILE);

    try {
      const input = AgentRefactoringService.buildInput(document, fnToRefactor, taskId);
      fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));

      logOutputChannel.info(`Agent refactoring started for task ${taskId}`);

      await AgentRefactoringService.invokeAgent(workDir, signal);

      if (!fs.existsSync(outputPath)) {
        throw new Error('Agent did not produce output file');
      }

      const outputContent = fs.readFileSync(outputPath, 'utf-8');
      const output: AgentOutput = JSON.parse(outputContent);

      logOutputChannel.info(`Agent refactoring completed for task ${taskId}: ${output.fix_result}`);

      return AgentRefactoringService.mapOutputToResponse(output, document, fnToRefactor);
    } finally {
      AgentRefactoringService.cleanup(workDir);
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

  private static invokeAgent(workDir: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const binaryPath = AgentRefactoringService.getAgentBinaryPath();
      const token = getEffectiveToken();
      if (!token) {
        reject(new Error('No authentication token available for agent'));
        return;
      }
      const config = buildAgentConfigWithToken(token);
      const configJson = JSON.stringify(config);

      const args: string[] = ['run', 'skill:render-code-fix'];
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
      });

      proc.stdout?.on('data', (data: Buffer) => {
        logOutputChannel.debug(`Agent stdout: ${data.toString()}`);
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

      for (const replacement of change.replacements) {
        code = code.replace(replacement.search, replacement.replace);
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

  private static cleanup(workDir: string): void {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (err) {
      logOutputChannel.warn(`Failed to cleanup work directory ${workDir}: ${err}`);
    }
  }
}
