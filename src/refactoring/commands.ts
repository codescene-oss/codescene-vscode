import vscode from 'vscode';
import Telemetry from '../telemetry';
import { logOutputChannel } from '../log';
import { CodeSmell } from '../devtools-api/review-model';
import {
  runRefactoringAgent,
  getFileTimestamp,
  showGitDiffView,
  codeSmellToRefactoringParams,
} from './refactoring-agent';
import { CsExtensionState } from '../cs-extension-state';

export class CsRefactoringCommands implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.commands.registerCommand(
        'codescene.requestAndPresentRefactoring',
        this.requestAndPresentRefactoringCmd,
        this
      )
    );
  }

  /**
   * Main entry point for the refactoring command.
   * Uses the new refactoring-agent binary to fix code health issues directly.
   */
  private async requestAndPresentRefactoringCmd(
    document: vscode.TextDocument,
    source: string,
    codeSmell?: CodeSmell
  ) {
    if (!codeSmell) {
      logOutputChannel.error('Could not refactor. Code smell is undefined.');
      void vscode.window.showErrorMessage('Cannot refactor: no code smell specified.');
      return;
    }

    const params = codeSmellToRefactoringParams(document, codeSmell);

    Telemetry.logUsage('refactor/requested', {
      source,
      file: params.filePath,
      line: params.line,
      smell: params.smell,
    });

    // Show progress notification while the agent runs
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Refactoring: ${params.smell}`,
        cancellable: true,
      },
      async (progress, cancellationToken) => {
        progress.report({ message: 'Running refactoring agent...' });

        // Capture file timestamp before running the agent
        const timestampBefore = await getFileTimestamp(params.filePath);

        const result = await runRefactoringAgent(this.context, params, cancellationToken);

        if (!result.success) {
          if (result.error !== 'Refactoring was cancelled') {
            void vscode.window.showErrorMessage(`Refactoring failed: ${result.error}`);
            Telemetry.logUsage('refactor/failed', {
              source,
              file: params.filePath,
              smell: params.smell,
              error: result.error,
            });
          }
          return;
        }

        // Capture file timestamp after running the agent
        const timestampAfter = await getFileTimestamp(params.filePath);

        // Check if the file was actually modified by comparing timestamps
        const hasActualChanges =
          timestampBefore !== null && timestampAfter !== null && timestampAfter > timestampBefore;

        if (hasActualChanges) {
          // Changes were made - show diff view
          await showGitDiffView(params.filePath);
          Telemetry.logUsage('refactor/completed', {
            source,
            file: params.filePath,
            smell: params.smell,
            hasChanges: true,
          });

          void vscode.window.showInformationMessage(
            'Refactoring complete. Review the changes in the diff view.'
          );
        } else {
          // No changes were made
          Telemetry.logUsage('refactor/completed', {
            source,
            file: params.filePath,
            smell: params.smell,
            hasChanges: false,
          });

          void vscode.window.showInformationMessage(
            'Refactoring completed but no changes were made to the file.'
          );
        }
      }
    );
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
