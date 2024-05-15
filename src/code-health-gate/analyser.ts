import path from 'path';
import vscode, { workspace } from 'vscode';
import { AnalysisEvent } from '../analysis-common';
import { csSource } from '../diagnostics/cs-diagnostics';
import { createCsDiagnosticCode, issueToRange } from '../diagnostics/utils';
import { SimpleExecutor } from '../executor';
import { logOutputChannel } from '../log';
import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import { isDefined } from '../utils';
import { DeltaForFile, Finding, isImprovement, toEndLineNumber, toStartLineNumber } from './model';

export type DeltaAnalysisEvent = AnalysisEvent & { path?: string };
export type DeltaAnalysisState = 'running' | 'failed' | 'no-issues-found';
export type DeltaAnalysisResult = DeltaForFile[] | DeltaAnalysisState;

export function registerDeltaCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('codescene.runDeltaAnalysis', () => {
      return DeltaAnalyser.analyseWorkspace();
    })
  );
}

export class DeltaAnalyser {
  private static _instance: DeltaAnalyser;

  private readonly errorEmitter = new vscode.EventEmitter<Error>();
  readonly onDidAnalysisFail = this.errorEmitter.event;
  private analysisEmitter: vscode.EventEmitter<DeltaAnalysisEvent> = new vscode.EventEmitter<DeltaAnalysisEvent>();
  readonly onDidAnalyse = this.analysisEmitter.event;
  private supportedCodeSmells?: string[];
  private analysesRunning = 0;

  readonly analysisResults: Map<string, DeltaForFile[] | DeltaAnalysisResult> = new Map();

  constructor(private cliPath: string) {}

  static init(cliPath: string) {
    DeltaAnalyser._instance = new DeltaAnalyser(cliPath);
  }

  static get instance() {
    return DeltaAnalyser._instance;
  }

  static analyseWorkspace() {
    const rootPaths = workspace.workspaceFolders?.map((folder) => {
      return folder.uri.fsPath;
    });
    if (!rootPaths || rootPaths.length === 0) {
      throw new Error('The CodeScene delta command can only be executed if VS Code is opened on a workspace folder.');
    }

    rootPaths.forEach(async (rootPath) => {
      void DeltaAnalyser.instance.runDeltaAnalysis(rootPath);
    });
  }

  static enableAce(supportedCodeSmells: string[]) {
    DeltaAnalyser.instance.supportedCodeSmells = supportedCodeSmells;
  }
  static disableAce() {
    DeltaAnalyser.instance.supportedCodeSmells = undefined;
  }

  private startAnalysisEvent(path: string) {
    this.analysesRunning++;
    this.analysisEmitter.fire({ type: 'start', path });
  }

  private endAnalysisEvent(path: string) {
    this.analysesRunning--;
    this.analysisEmitter.fire({ type: 'end', path });
    if (this.analysesRunning === 0) {
      this.analysisEmitter.fire({ type: 'idle' });
    }
  }

  private async runDeltaAnalysis(rootPath: string) {
    this.startAnalysisEvent(rootPath);
    DeltaAnalyser.instance.analysisResults.set(rootPath, 'running');
    return new SimpleExecutor()
      .execute({ command: this.cliPath, args: ['delta', '--output-format', 'json'] }, { cwd: rootPath })
      .then((result) => {
        if (result.stderr.trim() !== '') {
          logOutputChannel.debug(`Delta analysis debug output: ${result.stderr}`);
        }
        if (result.stdout === '') {
          DeltaAnalyser.instance.analysisResults.set(rootPath, []);
          return;
        }
        const deltaResults = JSON.parse(result.stdout) as DeltaForFile[];
        if (DeltaAnalyser.instance.supportedCodeSmells) {
          requestRefactoringsForDegradations(rootPath, deltaResults, DeltaAnalyser.instance.supportedCodeSmells);
        }
        DeltaAnalyser.instance.analysisResults.set(rootPath, deltaResults);
      })
      .catch((error) => {
        DeltaAnalyser.instance.analysisResults.set(rootPath, 'failed');
        this.errorEmitter.fire(error);
      })
      .finally(() => {
        this.endAnalysisEvent(rootPath);
      });
  }
}

/**
 * Try to send refactoring requests for all supported degradations found in these files
 *
 * @param deltaResults
 */
function requestRefactoringsForDegradations(
  rootPath: string,
  deltaResults: DeltaForFile[],
  supportedCodeSmells: string[]
) {
  deltaResults.forEach((delta) => {
    const absPath = path.join(rootPath, delta.name);
    const uri = vscode.Uri.file(absPath);
    vscode.workspace.openTextDocument(uri).then(
      async (doc) => {
        const diagnostics = diagnosticsForFile(doc, delta, supportedCodeSmells);
        delta.refactorings = await vscode.commands.executeCommand<CsRefactoringRequest[]>(
          'codescene.requestRefactorings',
          doc,
          diagnostics
        );
      },
      (err) => {
        logOutputChannel.error(`[Analyser] Failed to open ${uri.fsPath}: ${err}`);
      }
    );
  });
}

function diagnosticsForFile(document: vscode.TextDocument, delta: DeltaForFile, supportedCodeSmells: string[]) {
  return delta.findings
    .flatMap((finding) => {
      // Skip unsupported codesmells
      if (!supportedCodeSmells.includes(finding.category)) return;
      return diagnosticsFromFinding(document, finding);
    })
    .filter(isDefined);
}

function diagnosticsFromFinding(document: vscode.TextDocument, finding: Finding) {
  return finding['change-details']
    .flatMap((changeDetail) => {
      // Skip improvements and file level issues
      if (isImprovement(changeDetail['change-type'])) return;
      if (!changeDetail.locations) return;

      // function-level issues
      return changeDetail.locations.map((location) => {
        const range = issueToRange(
          finding.category,
          {
            name: location.function,
            startLine: toStartLineNumber(location),
            endLine: toEndLineNumber(location),
          },
          document
        );
        const diagnostic = new vscode.Diagnostic(range, finding.category, vscode.DiagnosticSeverity.Warning);
        diagnostic.source = csSource;
        diagnostic.code = createCsDiagnosticCode(finding.category);
        return diagnostic;
      });
    })
    .filter(isDefined);
}
