import vscode from 'vscode';
import { AnalysisEvent } from '../analysis-common';
import { LimitingExecutor } from '../executor';
import { logOutputChannel } from '../log';
import { isDefined } from '../utils';
import { DeltaForFile } from './model';

export type DeltaAnalysisEvent = AnalysisEvent & { document: vscode.TextDocument; result?: DeltaForFile };
export type DeltaAnalysisState = 'running' | 'failed' | 'no-issues-found';
export type DeltaAnalysisResult = DeltaForFile | DeltaAnalysisState;

export class DeltaAnalyser {
  private static _instance: DeltaAnalyser;

  private readonly errorEmitter = new vscode.EventEmitter<Error>();
  readonly onDidAnalysisFail = this.errorEmitter.event;
  private analysisEmitter: vscode.EventEmitter<DeltaAnalysisEvent> = new vscode.EventEmitter<DeltaAnalysisEvent>();
  readonly onDidAnalyse = this.analysisEmitter.event;
  private analysesRunning = 0;
  private executor = new LimitingExecutor();

  constructor(private binaryPath: string) {}

  static init(binaryPath: string) {
    DeltaAnalyser._instance = new DeltaAnalyser(binaryPath);
  }

  static get instance() {
    return DeltaAnalyser._instance;
  }

  private startAnalysisEvent(document: vscode.TextDocument) {
    this.analysesRunning++;
    this.analysisEmitter.fire({ type: 'start', document });
  }

  private endAnalysisEvent(document: vscode.TextDocument, result?: DeltaForFile) {
    this.analysesRunning--;
    this.analysisEmitter.fire({ type: 'end', document, result });
    if (this.analysesRunning === 0) {
      this.analysisEmitter.fire({ type: 'idle', document, result });
    }
  }

  /**
   * Creates a valid input string for the delta command.
   * Will return undefined if the old and new score are the same. Used to avoid invoking
   * the delta command.
   *
   * @param oldScore raw base64 encoded score
   * @param newScore raw base64 encoded score
   * @returns
   */
  private jsonForScores(oldScore?: string | void, newScore?: string | void) {
    if (oldScore === newScore) return; // No need to run the delta command if the scores are the same

    const scoreObject = {};
    if (isDefined(oldScore)) {
      Object.assign(scoreObject, { 'old-score': oldScore });
    }
    if (isDefined(newScore)) {
      Object.assign(scoreObject, { 'new-score': newScore });
    }

    if (Object.keys(scoreObject).length === 0) return; // if both are undefined the delta command will fail

    return JSON.stringify(scoreObject);
  }

  async deltaForScores(document: vscode.TextDocument, oldScore?: string | void, newScore?: string | void) {
    this.startAnalysisEvent(document);

    const inputJsonString = this.jsonForScores(oldScore, newScore);
    if (!inputJsonString) {
      this.endAnalysisEvent(document);
      return;
    }

    let deltaForFile: DeltaForFile | undefined;
    const { stdout, stderr, exitCode } = await this.executor.execute(
      { command: this.binaryPath, args: ['delta'], taskId: taskId(document), ignoreError: true },
      undefined,
      inputJsonString
    );

    switch (exitCode) {
      case 'ABORT_ERR':
        this.endAnalysisEvent(document, deltaForFile);
        return;
      case 1:
        logOutputChannel.debug(`Delta analysis output: '${stdout.trim()}'`);
        logOutputChannel.error(`CodeScene delta analysis failed: '${stderr.trim()}' (exit ${exitCode})`);
        this.errorEmitter.fire(new Error(stderr));
        this.endAnalysisEvent(document, deltaForFile);
        return;
    }

    if (exitCode === 0) {
      if (stdout.trim() === '') {
        this.endAnalysisEvent(document, deltaForFile);
        return;
      }
      deltaForFile = JSON.parse(stdout) as DeltaForFile;
      this.endAnalysisEvent(document, deltaForFile);
      return deltaForFile;
    }
  }
}

function taskId(document: vscode.TextDocument) {
  return `${document.uri.fsPath} v${document.version}`;
}
