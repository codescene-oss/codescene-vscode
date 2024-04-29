import vscode, { workspace } from 'vscode';
import { SimpleExecutor } from '../executor';
import { logOutputChannel } from '../log';
import { DeltaForFile } from './model';

export type DeltaAnalysisResult = Map<string, Promise<DeltaForFile[] | undefined>>;

export function registerDeltaCommand(context: vscode.ExtensionContext, cliPath: string) {
  context.subscriptions.push(
    vscode.commands.registerCommand('codescene.runDeltaAnalysis', async () => {
      const rootPaths = workspace.workspaceFolders?.map((folder) => {
        return folder.uri.fsPath;
      });
      if (!rootPaths || rootPaths.length === 0) {
        throw new Error('The CodeScene delta command can only be executed if VS Code is opened on a workspace folder.');
      }

      const results: DeltaAnalysisResult = new Map();
      rootPaths.map(async (rootPath) => {
        results.set(rootPath, deltaAnalysis(cliPath, rootPath));
      });
      return results;
    })
  );
}

export async function deltaAnalysis(cliPath: string, rootPath?: string) {
  const opts = rootPath ? { cwd: rootPath } : {};
  return new SimpleExecutor()
    .execute({ command: cliPath, args: ['delta', '--output-format', 'json'] }, opts)
    .then((result) => {
      // TODO - review log levels
      logOutputChannel.info(`Delta analysis debug output: ${result.stderr}`);
      if (result.stdout === '') return;
      return JSON.parse(result.stdout) as DeltaForFile[];
    })
    .catch((error) => {
      logOutputChannel.error(`Error running delta analysis in ${rootPath}: ${error}`);
      return undefined;
    });
}
