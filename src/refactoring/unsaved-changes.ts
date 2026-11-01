import path from 'path';
import vscode from 'vscode';

export const SAVE_AND_REFACTOR = 'Save and refactor';

export async function ensureSavedForRefactoring(document: vscode.TextDocument): Promise<boolean> {
  if (!document.isDirty) return true;

  const choice = await vscode.window.showWarningMessage(
    `Save ${path.basename(document.fileName)} before refactoring? The refactoring agent reads the file from disk.`,
    { modal: true },
    SAVE_AND_REFACTOR
  );
  if (choice !== SAVE_AND_REFACTOR) return false;

  return document.save();
}
