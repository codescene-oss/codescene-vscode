import vscode from 'vscode';
import { AnalysisEvent } from '../analysis-common';
import { CsExtensionState } from '../cs-extension-state';
import { csSource } from '../diagnostics/cs-diagnostics';
import { fnCoordinateToRange } from '../diagnostics/utils';
import { SimpleExecutor } from '../executor';
import { logOutputChannel } from '../log';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import { isDefined } from '../utils';
import { DeltaForFile, Finding, getEndLine, getStartLine, isDegradation } from './model';

export type DeltaAnalysisEvent = AnalysisEvent & { document?: vscode.TextDocument };
export type DeltaAnalysisState = 'running' | 'failed' | 'no-issues-found';
export type DeltaAnalysisResult = DeltaForFile | DeltaAnalysisState;

export class DeltaAnalyser {
  private static _instance: DeltaAnalyser;

  private readonly errorEmitter = new vscode.EventEmitter<Error>();
  readonly onDidAnalysisFail = this.errorEmitter.event;
  private analysisEmitter: vscode.EventEmitter<DeltaAnalysisEvent> = new vscode.EventEmitter<DeltaAnalysisEvent>();
  readonly onDidAnalyse = this.analysisEmitter.event;
  private analysesRunning = 0;

  readonly analysisResults: Map<string, DeltaForFile | DeltaAnalysisResult> = new Map();

  constructor(private cliPath: string) {}

  static init() {
    DeltaAnalyser._instance = new DeltaAnalyser(CsExtensionState.cliPath);
  }

  static get instance() {
    return DeltaAnalyser._instance;
  }

  private startAnalysisEvent(document: vscode.TextDocument) {
    this.analysesRunning++;
    this.analysisEmitter.fire({ type: 'start', document });
  }

  private endAnalysisEvent(document: vscode.TextDocument) {
    this.analysesRunning--;
    this.analysisEmitter.fire({ type: 'end', document });
    if (this.analysesRunning === 0) {
      this.analysisEmitter.fire({ type: 'idle' });
    }
  }

  /**
   * Creates a valid input string for the delta command.
   * Will return undefined if the old and new score are the same. Used to avoid invoking
   * the delta command.
   *
   * @param oldScore
   * @param newScore
   * @returns
   */
  private jsonForScores(oldScore: any, newScore: any) {
    const oldJson = JSON.stringify(oldScore);
    const newJson = JSON.stringify(newScore);
    if (oldJson === newJson) return;

    // The devtools binary handles either being undef, but not both
    if (isDefined(oldScore) || isDefined(newScore)) {
      // Make sure not to put "undefined" in the json string - it is an invalid json token while null is
      return `{"old-score": ${oldJson || null}, "new-score": ${newJson || null}}`;
    }
  }

  async deltaForScores(document: vscode.TextDocument, oldScore: any, newScore: any) {
    this.startAnalysisEvent(document);

    const inputJsonString = this.jsonForScores(oldScore, newScore);
    if (!inputJsonString) {
      this.endAnalysisEvent(document);
      return;
    }

    return new SimpleExecutor()
      .execute({ command: this.cliPath, args: ['delta'] }, undefined, inputJsonString)
      .then((result) => {
        if (result.stderr.trim() !== '') {
          logOutputChannel.debug(`Delta analysis debug output: ${result.stderr}`);
        }
        if (result.stdout.trim() === '') {
          return;
        }
        const deltaResult = JSON.parse(result.stdout) as DeltaForFile;
        if (CsExtensionState.acePreflight) {
          requestRefactoringsForDegradation({
            document,
            deltaResult,
            supportedCodeSmells: CsExtensionState.acePreflight.supported['code-smells'],
          });
        }
        return deltaResult;
      })
      .catch((error) => {
        this.errorEmitter.fire(error);
      })
      .finally(() => {
        this.endAnalysisEvent(document);
      });
  }
}

/**
 * Try to send a refactoring request for all supported degradations found in the document.
 */
function requestRefactoringsForDegradation({
  document,
  deltaResult,
  supportedCodeSmells,
}: {
  document: vscode.TextDocument;
  deltaResult: DeltaForFile;
  supportedCodeSmells: string[];
}) {
  const diagnostics = diagnosticsForFile(document, deltaResult, supportedCodeSmells);
  void vscode.commands.executeCommand<CsRefactoringRequest[]>('codescene.requestRefactorings', document, diagnostics);
}

function diagnosticsForFile(document: vscode.TextDocument, delta: DeltaForFile, supportedCodeSmells: string[]) {
  return (
    delta.findings
      // Include only supported codesmells
      .filter((finding) => supportedCodeSmells.includes(finding.category))
      .flatMap((finding) => {
        return diagnosticsFromFinding(document, finding);
      })
  );
}

function diagnosticsFromFinding(document: vscode.TextDocument, finding: Finding) {
  return (
    finding['change-details']
      // Only consider degradations
      .filter((changeDetail) => isDegradation(changeDetail['change-type']))
      .flatMap((changeDetail) => {
        // function-level issues (file level issues have no locations)
        return changeDetail.locations?.map((location) => {
          const range = fnCoordinateToRange(
            finding.category,
            {
              name: location.function,
              startLine: getStartLine(location),
              endLine: getEndLine(location),
            },
            document
          );
          const diagnostic = new vscode.Diagnostic(range, finding.category, vscode.DiagnosticSeverity.Warning);
          diagnostic.source = csSource;
          diagnostic.code = finding.category;
          return diagnostic;
        });
      })
      .filter(isDefined)
  );
}
