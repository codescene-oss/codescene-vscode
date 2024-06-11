import { readFile } from 'fs/promises';
import { join } from 'path';
import vscode, { Range } from 'vscode';
import Telemetry from './telemetry';

export function getFileExtension(filename: string) {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2);
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

export function pluralize(noun: string, count: number) {
  return count === 1 ? noun : `${noun}s`;
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
 * Register a command with this function to automatically log telemetry when executed.
 * Essentially wraps vscode.commands.registerCommand, adding Telemetry.logUsage with optional
 * eventData.
 */
export function registerCommandWithTelemetry({
  commandId,
  handler,
  thisArg,
  logArgs,
}: {
  commandId: string;
  handler: (...args: any[]) => any;
  thisArg?: any;
  logArgs?: (...args: any[]) => any;
}): vscode.Disposable {
  const wrappedHandler = (...args: any[]) => {
    const eventName = `command/${commandId}`;
    let eventData;
    if (isDefined(logArgs)) {
      eventData = logArgs(...args);
    }
    Telemetry.instance.logUsage(eventName, eventData);
    return handler.apply(thisArg, args);
  };
  return vscode.commands.registerCommand(commandId, wrappedHandler, thisArg);
}
