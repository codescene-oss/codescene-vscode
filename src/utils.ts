import { readFile } from 'fs/promises';
import { join } from 'path';
import vscode, { Range } from 'vscode';
import { logOutputChannel } from './log';
import { AbortError } from './devtools-api';

export function toUppercase(word: String) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function getFileExtension(filename: string) {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2);
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

export function assertError(val: unknown) {
  if (!isError(val)) {
    return new Error(`Unknown error caught: ${val}`);
  }
  return val;
}

interface ReportErrorProps {
  context: string;
  e: unknown; // From catch clause
  consoleOnly?: boolean;
}

export const networkErrors = {
  javaConnectException: 'java.net.ConnectException',
  javaHttpTimeoutException: 'java.net.http.HttpTimeoutException',
  getAddrInfoNotFound: 'getaddrinfo ENOTFOUND',
  eConnRefused: 'ECONNREFUSED',
  // add more later if needed
} as const;

/**
 * Unified error reporting for catch clauses
 *
 * Print the error to logOutputChannel and show an error message, or optionally focus the log output.
 */
export function reportError({ context, e, consoleOnly = false }: ReportErrorProps) {
  // Ignore abort errors - they are expected when sending abort signal to the devtools API
  if (e instanceof AbortError) return;

  const error = assertError(e);

  const isNetworkError = error.message.toLowerCase().includes(networkErrors.getAddrInfoNotFound.toLowerCase());
  let message = isNetworkError
    ? `${context}. Server is unreachable. Ensure you have a stable internet connection.`
    : `${context}. ${error.message}`;

  logOutputChannel.error(`${message} ${!isNetworkError ? JSON.stringify(error) : ''}`);
  if (consoleOnly) {
    logOutputChannel.show();
  } else {
    void vscode.window.showErrorMessage(message);
  }
}

export function pluralize(noun: string, count: number) {
  return Math.abs(count) <= 1 ? noun : `${noun}s`;
}

export function round(score: number, nDecimals: number): number {
  return +score.toFixed(nDecimals);
}

let logoUrl: string | undefined;
export async function getLogoUrl(extensionPath: string): Promise<string> {
  if (!logoUrl) {
    // Read the logo from the extension's assets folder and base64 encode it.
    const path = join(extensionPath, 'assets', 'cs-logo-small.png');
    const data = await readFile(path);
    logoUrl = data.toString('base64');
  }
  return logoUrl;
}

export function rangeStr(range: Range) {
  return `[${range.start.line + 1}:${range.start.character}→${range.end.line + 1}:${range.end.character}]`;
}

/**
 * Attempt to show the given document in VS Code, focusing an existing editor if open,
 * or opening it if not. Optionally move the cursor to a given position and reveal it.
 *
 * @param uri
 * @param position
 * @returns
 */
export async function showDocAtPosition(document: vscode.TextDocument | undefined, position?: vscode.Position) {
  if (!document) {
    logOutputChannel.warn('Could not focus on line in editor as it is undefined.');
    return;
  }

  const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === document.uri.toString());

  const activeEditor = editor
    ? await vscode.window.showTextDocument(editor.document, editor.viewColumn)
    : await vscode.window.showTextDocument(document, { preview: false });

  if (position) {
    activeEditor.selection = new vscode.Selection(position, position);
    activeEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}

export function safeJsonParse(input: string, context?: any) {
  try {
    return JSON.parse(input);
  } catch (error) {
    const contextStr = context ? `\nContext: ${JSON.stringify(context)}` : '';
    logOutputChannel.error(`JSON parsing failed: ${error}\nInput: ${input}${contextStr}`);
    throw error;
  }
}
