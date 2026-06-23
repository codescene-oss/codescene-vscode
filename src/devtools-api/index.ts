import { Review } from '../devtools-api/review-model';
import { assertError, getWorkspaceCwd, safeJsonParse } from '../utils';
import { CheckRulesResponse, CodeHealthRulesResult, CodeHealthRulesTemplateResponse } from './model';

import { basename, dirname } from 'path';
import { existsSync } from 'fs';
import vscode, { ExtensionContext, TextDocument } from 'vscode';
import { CodeSceneAuthenticationSession } from '../auth/auth-provider';
import { getAuthToken } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { logOutputChannel } from '../log';
import { StatsCollector } from '../stats';
import { Delta } from './delta-model';
import { jsonForScores } from './delta-utils';
import { TelemetryEvent, TelemetryResponse } from './telemetry-model';
import { ReviewCache } from './review-cache';
import { DevtoolsAPIImpl, BinaryOpts } from './devtools-api-impl';
import { AbortError } from './abort-error';
import { IsCpuTooBusyFn } from '../cpu-usage-based-executor';
import { DevtoolsError } from './devtools-error';

const TELEMETRY_POST_TASK_ID = 'telemetry-post';
const TELEMETRY_DEVICE_ID_TASK_ID = 'telemetry-device-id';
const DELTA_TASK_ID_PREFIX = 'delta';

export class DevtoolsAPI {
  private static instance: DevtoolsAPIImpl;
  private static reviewCache: ReviewCache;

  static init(binaryPath: string, context: ExtensionContext, isCpuTooBusyFn?: IsCpuTooBusyFn) {
    DevtoolsAPI.instance = new DevtoolsAPIImpl(binaryPath, context, isCpuTooBusyFn);
    DevtoolsAPI.reviewCache = new ReviewCache(context);
  }

  static get concurrencyLimitingExecutor() {
    return DevtoolsAPI.instance.concurrencyLimitingExecutor;
  }

  static get networkError() {
    return DevtoolsAPI.instance?.networkError ?? false;
  }

  /**
   * Executes the command for creating a code health rules template.
   */
  static async codeHealthRulesTemplate() {
    const result = await DevtoolsAPI.instance.runBinary({
      args: ['run-command', 'code-health-rules-template'],
      input: JSON.stringify({}),
      execOptions: { cwd: getWorkspaceCwd() }
    });
    const response = safeJsonParse(result.stdout, { command: 'code-health-rules-template' }) as CodeHealthRulesTemplateResponse;
    return response.template;
  }

  /**
   * Executes the command for checking code health rule match against file
   */
  static async checkRules(rootPath: string, filePath: string) {
    const payload = {
      'path': filePath,
    };

    const { stdout, stderr } = await DevtoolsAPI.instance.runBinary({
      args: ['run-command', 'check-rules'],
      input: JSON.stringify(payload),
      execOptions: { cwd: rootPath },
    });

    try {
      const { result, 'parsing-errors': parsingErrors, failed } = safeJsonParse(stdout, { command: 'check-rules', args: payload }) as CheckRulesResponse;

      if (failed) {
        if (parsingErrors && parsingErrors.length > 0) {
          const errorMessages = parsingErrors.map((err: any) => {
            return err.message;
          }).join('\n');
          const report = `Problem in ruleset:\n${errorMessages}\nFailed to parse the code health rule set`;
          return {
            rulesMsg: result,
            errorMsg: report,
          } as CodeHealthRulesResult;
        }

        return {
          rulesMsg: result,
        } as CodeHealthRulesResult;
      }

      return { rulesMsg: result } as CodeHealthRulesResult;
    } catch (error) {
      return { errorMsg: stderr } as CodeHealthRulesResult;
    }

  }

  private static readonly analysisStateEmitter = new vscode.EventEmitter<AnalysisEvent>();
  /** Emits events when review or delta analysis state changes (running/idle?) */
  public static readonly onDidAnalysisStateChange = DevtoolsAPI.analysisStateEmitter.event;
  private static analysesRunning = 0;
  public static get isAnalysisRunning(): boolean {
    return DevtoolsAPI.analysesRunning > 0;
  }
  public static setAnalysesRunningForTesting(count: number): void {
    DevtoolsAPI.analysesRunning = count;
  }
  public static jobs = new Set<string>(); // Keep track of the filename of current jobs
  private static readonly analysisErrorEmitter = new vscode.EventEmitter<Error>();
  public static readonly onDidAnalysisFail = DevtoolsAPI.analysisErrorEmitter.event;

  // Adding to the jobs set if it's a delta analysis
  private static startAnalysisEvent(fileName: string, delta?: boolean) {
    delta && DevtoolsAPI.jobs.add(fileName);
    DevtoolsAPI.analysesRunning++;
    DevtoolsAPI.analysisStateEmitter.fire({ state: 'running', jobs: DevtoolsAPI.jobs });
  }

  private static endAnalysisEvent(fileName: string, delta?: boolean) {
    delta && DevtoolsAPI.jobs.delete(fileName); // Remove filename from jobs list on completed delta analysis
    DevtoolsAPI.analysesRunning--;
    if (DevtoolsAPI.analysesRunning === 0) {
      DevtoolsAPI.analysisStateEmitter.fire({ state: 'idle' });
    }
  }

  private static readonly reviewEmitter = new vscode.EventEmitter<ReviewEvent>();
  public static readonly onDidReviewComplete = DevtoolsAPI.reviewEmitter.event;

  static async reviewContent(document: vscode.TextDocument) {
    const fp = fileParts(document);
    if (!validateFileParts('reviewContent', fp, document)) {
      return;
    }
    const cachePath = DevtoolsAPI.reviewCache.getCachePath();

    const payload = {
      'path': fp.fileName,
      'file-content': document.getText(),
      ...(cachePath ? { 'cache-path': cachePath } : {}),
    };

    const binaryOpts = {
      args: ['run-command', 'review'],
      taskId: taskId('review', document),
      execOptions: { cwd: fp.documentDirectory },
      input: JSON.stringify(payload),
    };

    DevtoolsAPI.startAnalysisEvent(document.fileName);
    try {
      const reviewResult = await DevtoolsAPI.review(document, binaryOpts);
      if (reviewResult['code-health-rules-error']) {
        // TODO - maybe show a popup notification? Might become spammy when having multiple files open...
        const { description, remedy } = reviewResult['code-health-rules-error'];
        logOutputChannel.warn(`${description}`);
        logOutputChannel.warn(`${remedy}`);
      }
      DevtoolsAPI.reviewEmitter.fire({ document, result: reviewResult });
      return reviewResult;
    } catch (e) {
      if (!(e instanceof AbortError)) {
        DevtoolsAPI.analysisErrorEmitter.fire(assertError(e));
      }
    } finally {
      DevtoolsAPI.endAnalysisEvent(document.fileName);
    }
  }

  static async reviewBaseline(baselineCommit: string, document: vscode.TextDocument) {
    const fp = fileParts(document);
    if (!validateFileParts('reviewBaseline', fp, document)) {
      return;
    }
    const cachePath = DevtoolsAPI.reviewCache.getCachePath();

    const path = `${baselineCommit}:./${fp.fileName}`;

    const payload = {
      'path': path,
      ...(cachePath ? { 'cache-path': cachePath } : {}),
    };

    const binaryOpts = {
      args: ['run-command', 'review'],
      taskId: taskId('review-base', document),
      execOptions: { cwd: fp.documentDirectory },
      input: JSON.stringify(payload),
    };

    DevtoolsAPI.startAnalysisEvent(document.fileName);
    try {
      return await DevtoolsAPI.review(document, binaryOpts);
    } catch (e) {
      if (e instanceof DevtoolsError) {
        // Just return on regular devtoolerrors - this just means that we don't have any baseline to compare to
        return;
      }
      if (!(e instanceof AbortError)) {
        DevtoolsAPI.analysisErrorEmitter.fire(assertError(e));
      }
      throw e;
    } finally {
      DevtoolsAPI.endAnalysisEvent(document.fileName);
    }
  }

  private static async review(document: TextDocument, opts: BinaryOpts) {
    const { stdout, duration } = await DevtoolsAPI.instance.runBinary(opts);
    StatsCollector.instance.recordAnalysis(document.fileName, duration);
    return safeJsonParse(stdout) as Review;
  }

  static abortReviews(document: TextDocument) {
    DevtoolsAPI.instance.concurrencyLimitingExecutor.abort(taskId('review', document));
    DevtoolsAPI.instance.concurrencyLimitingExecutor.abort(taskId('review-base', document));
  }

  private static readonly deltaAnalysisEmitter = new vscode.EventEmitter<DeltaAnalysisEvent>();
  public static readonly onDidDeltaAnalysisComplete = DevtoolsAPI.deltaAnalysisEmitter.event;

  /**
   * Runs delta analysis and returns the result. Also fires onDidDeltaAnalysisComplete when analysis is complete.
   *
   * @param document
   * @param updateMonitor whether to update the Code Health Monitor tree view
   * @param oldScore raw base64 encoded score
   * @param newScore raw base64 encoded score
   * @returns Delta if any changes were detected or undefined when no improvements/degradations were found.
   */
  static async delta(document: TextDocument, updateMonitor: boolean, oldScore?: string | void, newScore?: string | void) {
    const inputJsonString = jsonForScores(oldScore, newScore);
    if (!inputJsonString) {
      logOutputChannel.debug(`Delta analysis skipped for ${basename(document.fileName)}: no input scores`);
      return;
    }
    const fp = fileParts(document);
    if (!validateFileParts('delta', fp, document)) {
      return;
    }

    DevtoolsAPI.startAnalysisEvent(document.fileName, true);
    try {
      const result = await DevtoolsAPI.instance.runBinary({
        args: ['run-command', 'delta'],
        input: inputJsonString,
        taskId: taskId(DELTA_TASK_ID_PREFIX, document),
        execOptions: { cwd: fp.documentDirectory },
      });
      let deltaResult;
      if (result.stdout && result.stdout.trim() !== '') {
        const parsedResult = safeJsonParse(result.stdout) as Delta | null;
        if (parsedResult) {
          deltaResult = parsedResult;
          logOutputChannel.info(`Delta analysis completed for ${basename(document.fileName)}: score-change=${deltaResult['score-change']}`);
        } else {
          logOutputChannel.debug(`Delta analysis completed for ${basename(document.fileName)}: no changes detected`);
        }
      } else {
        logOutputChannel.debug(`Delta analysis completed for ${basename(document.fileName)}: no changes detected`);
      }
      DevtoolsAPI.deltaAnalysisEmitter.fire({ document, result: deltaResult, updateMonitor });
      return deltaResult;
    } catch (e) {
      const error = assertError(e);
      if (!(e instanceof AbortError)) {
        logOutputChannel.error(`Delta analysis failed for ${basename(document.fileName)}: ${error.message}`);
        if (error.stack) {
          logOutputChannel.error(`Stack trace: ${error.stack}`);
        }
        DevtoolsAPI.analysisErrorEmitter.fire(assertError(e));
      }
    } finally {
      DevtoolsAPI.endAnalysisEvent(document.fileName, true);
    }
  }

  static postTelemetry(event: TelemetryEvent) {
    const payload = { event };
    return DevtoolsAPI.instance.executeAsJson<TelemetryResponse>({
      args: ['run-command', 'telemetry'],
      input: JSON.stringify(payload),
      execOptions: { cwd: getWorkspaceCwd() },
      taskId: TELEMETRY_POST_TASK_ID
    });
  }

  static async getDeviceId() {
    const result = await DevtoolsAPI.instance.runBinary({
      args: ['run-command', 'telemetry'],
      input: JSON.stringify({"device-id": true}),
      execOptions: { cwd: getWorkspaceCwd() },
      taskId: TELEMETRY_DEVICE_ID_TASK_ID
    });
    const json = safeJsonParse(result.stdout, { command: 'telemetry', args: { 'device-id': true } });
    return json['device-id'];
  }

  static dispose() {
    try { DevtoolsAPI.instance?.concurrencyLimitingExecutor.dispose(); } catch {}
    try { DevtoolsAPI.analysisStateEmitter.dispose(); } catch {}
    try { DevtoolsAPI.analysisErrorEmitter.dispose(); } catch {}
    try { DevtoolsAPI.reviewEmitter.dispose(); } catch {}
    try { DevtoolsAPI.deltaAnalysisEmitter.dispose(); } catch {}
  }
}

type CmdId = 'review' | 'review-base' | 'delta';
function taskId(cmdId: CmdId, document: TextDocument) {
  return `${cmdId} ${document.fileName} v${document.version}`;
}

interface FileParts {
  fileName: string;
  documentDirectory: string;
}
function fileParts(document: vscode.TextDocument): FileParts {
  const fileName = basename(document.fileName);

  // Get the fsPath of the current document because we want to execute the
  // 'cs review' command in the same directory as the current document
  // (i.e. inside the repo to pick up on any .codescene/code-health-config.json file)
  const documentDirectory = dirname(document.fileName);
  return { fileName, documentDirectory };
}

function validateFileParts(operation: string, fp: FileParts, document: vscode.TextDocument): boolean {
  if (!fp.documentDirectory?.trim()) { // Cheap check (null / blank string)
    logOutputChannel.warn(`Operation ${operation} skipped for ${basename(document.fileName)}: document directory is empty`);
    return false;
  }
  let exists = true;
  try {
    exists = existsSync(fp.documentDirectory);  // Slightly more expensive check (filesystem-based)
  } catch (e) {
    // If existsSync throws, default to true (we don't want to foil an operation for an unknown reason)
  }
  if (!exists) {
    logOutputChannel.warn(`Operation ${operation} skipped for ${basename(document.fileName)}: document directory does not exist: ${fp.documentDirectory}`);
    return false;
  }
  return true;
}

export function isCodeSceneSession(x: vscode.AuthenticationSession): x is CodeSceneAuthenticationSession {
  return (<CodeSceneAuthenticationSession>x).url !== undefined;
}

export function getEffectiveToken(): string | undefined {
  const configToken = getAuthToken();
  const session = CsExtensionState.stateProperties.session;
  const sessionToken = session && isCodeSceneSession(session) ? session.accessToken : undefined;

  const token = configToken || sessionToken;
  return token && token.trim() !== '' ? token : undefined;
}


export type AnalysisEvent = {
  state: 'running' | 'idle';
  jobs?: Set<string>;
};

export type ReviewEvent = {
  document: vscode.TextDocument;
  result?: Review;
};

export type DeltaAnalysisEvent = {
  document: vscode.TextDocument;
  result?: Delta;
  updateMonitor: boolean; // Please set this to false if triggering reviews due to opening files, and to true if triggering reviews due to Git changes.
};
