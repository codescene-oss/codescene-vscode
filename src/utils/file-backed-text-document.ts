import { readFile, stat } from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Minimal TextDocument backed by disk content. Avoids vscode.workspace.openTextDocument,
 * which triggers expensive workspace indexing (ripgrep) for background reviews.
 */
export class FileBackedTextDocument implements vscode.TextDocument {
  private readonly _uri: vscode.Uri;
  private readonly _fileName: string;
  private readonly _content: string;
  private readonly _version: number;

  private constructor(filePath: string, content: string, version: number) {
    this._fileName = path.normalize(filePath);
    this._content = content;
    this._version = version;
    this._uri = vscode.Uri.file(this._fileName);
  }

  static async fromPath(filePath: string): Promise<FileBackedTextDocument | undefined> {
    try {
      const normalizedPath = path.normalize(filePath);
      const [content, fileStat] = await Promise.all([
        readFile(normalizedPath, 'utf8'),
        stat(normalizedPath),
      ]);
      const version = Math.max(1, Math.floor(fileStat.mtimeMs));
      return new FileBackedTextDocument(normalizedPath, content, version);
    } catch {
      return undefined;
    }
  }

  get uri() { return this._uri; }
  get fileName() { return this._fileName; }
  get isUntitled() { return false; }
  get languageId() { return ''; }
  get version() { return this._version; }
  get isDirty() { return false; }
  get isClosed() { return false; }
  get eol() { return vscode.EndOfLine.LF; }
  get lineCount() { return this._content.split('\n').length; }
  get encoding() { return 'utf8'; }

  lineAt(line: number | vscode.Position): vscode.TextLine {
    const lineNumber = typeof line === 'number' ? line : line.line;
    const text = this._content.split('\n')[lineNumber] || '';
    return {
      lineNumber,
      text,
      range: new vscode.Range(lineNumber, 0, lineNumber, text.length),
      rangeIncludingLineBreak: new vscode.Range(lineNumber, 0, lineNumber + 1, 0),
      firstNonWhitespaceCharacterIndex: text.search(/\S/),
      isEmptyOrWhitespace: text.trim().length === 0,
    };
  }

  offsetAt(position: vscode.Position): number {
    const lines = this._content.split('\n');
    let offset = 0;
    for (let i = 0; i < position.line && i < lines.length; i++) {
      offset += lines[i].length + 1;
    }
    return offset + position.character;
  }

  positionAt(offset: number): vscode.Position {
    const lines = this._content.split('\n');
    let currentOffset = 0;
    for (let line = 0; line < lines.length; line++) {
      const lineLength = lines[line].length + 1;
      if (currentOffset + lineLength > offset) {
        return new vscode.Position(line, offset - currentOffset);
      }
      currentOffset += lineLength;
    }
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
  }

  getText(range?: vscode.Range): string {
    if (!range) {
      return this._content;
    }
    return this._content.substring(this.offsetAt(range.start), this.offsetAt(range.end));
  }

  getWordRangeAtPosition(): vscode.Range | undefined { return undefined; }
  validateRange(range: vscode.Range): vscode.Range { return range; }
  validatePosition(position: vscode.Position): vscode.Position { return position; }
  save(): Thenable<boolean> { return Promise.resolve(true); }
}
