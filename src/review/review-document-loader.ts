import * as path from 'path';
import * as vscode from 'vscode';
import { FileBackedTextDocument } from '../utils/file-backed-text-document';

function pathsEqual(a: string, b: string): boolean {
  const normalizedA = path.normalize(a);
  const normalizedB = path.normalize(b);
  if (process.platform === 'win32') {
    return normalizedA.toLowerCase() === normalizedB.toLowerCase();
  }
  return normalizedA === normalizedB;
}

function findOpenTextDocument(filePath: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((document) => pathsEqual(document.fileName, filePath));
}

export interface LoadDocumentForReviewOptions {
  /** When true, fall back to vscode.workspace.openTextDocument for visible-tab files. */
  allowOpenTextDocument?: boolean;
}

/**
 * Loads file content for background code-health review without triggering VS Code's
 * openTextDocument indexing pipeline when the file is not already open in an editor.
 */
export async function loadDocumentForBackgroundReview(
  filePath: string,
  options: LoadDocumentForReviewOptions = {}
): Promise<vscode.TextDocument | undefined> {
  const openDocument = findOpenTextDocument(filePath);
  if (openDocument) {
    return openDocument;
  }

  if (options.allowOpenTextDocument) {
    try {
      return await vscode.workspace.openTextDocument(filePath);
    } catch {
      return undefined;
    }
  }

  return FileBackedTextDocument.fromPath(filePath);
}
