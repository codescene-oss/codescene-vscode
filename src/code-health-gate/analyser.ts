import vscode, { workspace } from 'vscode';
import { SimpleExecutor } from '../executor';
import { logOutputChannel } from '../log';
import { DeltaForFile } from './model';
import { AnalysisEvent } from '../analysis-common';

export type DeltaAnalysisEvent = AnalysisEvent & { path?: string };
export type DeltaAnalysisState = 'running' | 'failed';
export type DeltaAnalysisResult = DeltaForFile[] | DeltaAnalysisState;

export function registerDeltaCommand(context: vscode.ExtensionContext, cliPath: string) {
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
      void DeltaAnalyser._instance.runDeltaAnalysis(rootPath);
    });
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

  async runDeltaAnalysis(rootPath: string) {
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
        DeltaAnalyser.instance.analysisResults.set(rootPath, JSON.parse(result.stdout) as DeltaForFile[]);
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
