import vscode, { workspace } from 'vscode';
import { SimpleExecutor } from '../executor';
import { logOutputChannel } from '../log';
import { DeltaForFile } from './model';

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
  private analysisStartEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  readonly onDidAnalysisStart = this.analysisStartEmitter.event;
  private analysisEndEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  readonly onDidAnalysisEnd = this.analysisEndEmitter.event;

  readonly analysisResults: Map<string, DeltaForFile[] | DeltaAnalysisResult> = new Map();

  constructor(private cliPath: string) {}

  static init(cliPath: string) {
    DeltaAnalyser._instance = new DeltaAnalyser(cliPath);
  }

  static get instance() {
    return DeltaAnalyser._instance;
  }

  static analyseWorkspace() {
    return DeltaAnalyser._instance.analyseWorkspace();
  }

  async analyseWorkspace() {
    const rootPaths = workspace.workspaceFolders?.map((folder) => {
      return folder.uri.fsPath;
    });
    if (!rootPaths || rootPaths.length === 0) {
      throw new Error('The CodeScene delta command can only be executed if VS Code is opened on a workspace folder.');
    }

    rootPaths.forEach(async (rootPath) => {
      void this.runDeltaAnalysis(rootPath);
    });
  }

  async runDeltaAnalysis(rootPath: string) {
    this.analysisStartEmitter.fire();
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
        logOutputChannel.error(`Error running delta analysis in ${rootPath}: ${error}`);
        DeltaAnalyser.instance.analysisResults.set(rootPath, 'failed');
      })
      .finally(() => {
        this.analysisEndEmitter.fire();
      });
  }
}
