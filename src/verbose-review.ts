import vscode, { window } from 'vscode';
import Reviewer from './review/reviewer';

/**
 * Command to show verbose response for review command in current file. This will help users understand if the rules file is configured properly.
 * @returns void
 */
export function registerCommand(context: vscode.ExtensionContext, documentSelector: vscode.DocumentSelector) {
  const disposable = vscode.commands.registerCommand('codescene.showVerboseReview', () => {
    const document = window.activeTextEditor?.document;

    if (!document || vscode.languages.match(documentSelector, document) === 0) {
      void window.showErrorMessage('No valid file selected.');
      return;
    }

    void Reviewer.instance.review(document, { skipCache: true, verbose: true });
  });

  context.subscriptions.push(disposable);
}
