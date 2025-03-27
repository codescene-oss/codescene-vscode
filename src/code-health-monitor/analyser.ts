import vscode from 'vscode';
import { AnalysisEvent } from '../analysis-common';
import { AbortError, DevtoolsAPI } from '../devtools-api';
import { vscodeRange } from '../review/utils';
import { isDefined } from '../utils';
import { DeltaForFile } from './model';

export type DeltaAnalysisEvent = AnalysisEvent & { document: vscode.TextDocument; result?: DeltaForFile };

export class DeltaAnalyser {
  private static _instance: DeltaAnalyser;

  private readonly errorEmitter = new vscode.EventEmitter<Error>();
  readonly onDidAnalysisFail = this.errorEmitter.event;
  private analysisEmitter: vscode.EventEmitter<DeltaAnalysisEvent> = new vscode.EventEmitter<DeltaAnalysisEvent>();
  readonly onDidAnalyse = this.analysisEmitter.event;
  private analysesRunning = 0;

  constructor() {}

  static init() {
    DeltaAnalyser._instance = new DeltaAnalyser();
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

    try {
      deltaForFile = await DevtoolsAPI.deltaForFile(document, inputJsonString);
      if (deltaForFile) {
        await this.addRefactorableFunctionsToDeltaResult(document, deltaForFile);
      }
      return deltaForFile;
    } catch (e) {
      if (e instanceof Error && !(e instanceof AbortError)) {
        this.errorEmitter.fire(e);
      }
    } finally {
      this.endAnalysisEvent(document, deltaForFile);
    }
  }

  /**
   * NOTE - Mutates the delta result by adding info about refactorable functions to the 'function-level-findings' list.
   */
  private async addRefactorableFunctionsToDeltaResult(document: vscode.TextDocument, deltaForFile: DeltaForFile) {
    const functionsToRefactor = await DevtoolsAPI.fnsToRefactorFromDelta(document, deltaForFile);
    if (!functionsToRefactor) return;

    // Add a refactorableFn property to the findings that matches function name and range
    deltaForFile['function-level-findings'].forEach((finding) => {
      const findingRange = vscodeRange(finding.function.range);
      if (!findingRange) return;
      const refactorableFunctionForFinding = functionsToRefactor.find(
        (fn) => fn.name === finding.function.name && fn.vscodeRange.intersection(findingRange)
      );
      finding.refactorableFn = refactorableFunctionForFinding;
    });
  }
}
