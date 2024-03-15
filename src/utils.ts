import { readFile } from 'fs/promises';
import { join } from 'path';
import { Diagnostic, Range } from 'vscode';

export type DiagnosticFilter = (d: Diagnostic) => boolean;

export function getFileExtension(filename: string) {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2);
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
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
  return `[${range.start.line + 1}:${range.start.character}->${range.end.line + 1}:${range.end.character}]`;
}
