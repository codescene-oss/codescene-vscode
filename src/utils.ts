import { readFile } from 'fs/promises';
import { join } from 'path';
import vscode, { Range } from 'vscode';
import { logOutputChannel } from './log';
import { AbortError } from './devtools-api';

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

/**
 * Unified error reporting for catch clauses
 *
 * Print the error to logOutputChannel and show an error message, or optionally focus the log output.
 */
export function reportError({ context, e, consoleOnly = false }: ReportErrorProps) {
  // Ignore abort errors - they are expected when sending abort signal to the devtools API
  if (e instanceof AbortError) return;

  const error = assertError(e);
  const message = `${context}. ${error.message}`;
  delete error.stack;
  logOutputChannel.error(`${message} ${JSON.stringify(error)}`);
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
 * Navigate to the position in the file specified by uri. If we have no position, just make sure
 * the document is shown.
 *
 * @param uri
 * @param position
 * @returns
 */
export async function showDocAtPosition(document: vscode.TextDocument, position?: vscode.Position) {
  if (!isDefined(position)) {
    await vscode.window.showTextDocument(document);
    return;
  }
  const location = new vscode.Location(document.uri, position);
  return vscode.commands.executeCommand('editor.action.goToLocations', document.uri, position, [location]);
}
