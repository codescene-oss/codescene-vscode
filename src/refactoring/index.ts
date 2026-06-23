import vscode from 'vscode';
import { CsRefactoringCommands } from './commands';

/**
 * Initialize the refactoring feature.
 * Registers commands for the refactoring-agent based workflow.
 *
 * @param context VS Code extension context
 */
export function initRefactoring(context: vscode.ExtensionContext) {
  context.subscriptions.push(new CsRefactoringCommands(context));
}
