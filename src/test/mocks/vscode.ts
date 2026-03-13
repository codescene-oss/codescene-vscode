/* eslint-disable @typescript-eslint/naming-convention */

import { MockTextDocument } from './mock-text-document';
import { Position } from './position';
import { Range } from './range';
import { Selection } from './selection';
import { WorkspaceEdit } from './workspace-edit';
import { CodeAction } from './code-action';
import { MockEditor } from './mock-editor';

export async function openTextDocument(options: { content: string; language: string }) {
  return new MockTextDocument(options.content, options.language);
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum EndOfLine {
  LF = 1,
  CRLF = 2,
}

export interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: any;
}

export interface CodeActionContext {
  diagnostics: any[];
  only?: string;
  triggerKind?: number;
}

export interface Uri {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;
  fsPath: string;
  with(change: any): Uri;
  toString(): string;
  toJSON(): any;
}

export interface Disposable {
  dispose(): any;
}

export interface Extension<T> {
  id: string;
  extensionUri: Uri;
  extensionPath: string;
  isActive: boolean;
  packageJSON: any;
  extensionKind: any;
  exports: T;
  activate(): Thenable<T>;
}

export interface ExtensionContext {
  subscriptions: Disposable[];
  extensionPath: string;
  extensionUri: Uri;
  globalState: any;
  workspaceState: any;
  secrets: any;
  storagePath: string;
  globalStoragePath: string;
  logPath: string;
  extensionMode: number;
  environmentVariableCollection: any;
  asAbsolutePath: (relativePath: string) => string;
  storageUri: Uri;
  globalStorageUri: Uri;
  logUri: Uri;
  extensionRuntime?: any;
  extension: Extension<any>;
  languageModelAccessInformation: any;
}

export namespace Uri {
  export function file(path: string): Uri {
    return {
      scheme: 'file',
      authority: '',
      path: path,
      query: '',
      fragment: '',
      fsPath: path,
      with(change: any): Uri {
        return { ...this, ...change };
      },
      toString(): string {
        return this.fsPath;
      },
      toJSON(): any {
        return { scheme: this.scheme, path: this.path, fsPath: this.fsPath };
      }
    };
  }
}

export namespace workspace {
  export function onDidChangeConfiguration(listener: (e: any) => any): Disposable {
    return { dispose: () => {} };
  }
}

export { Position, Range, Selection, WorkspaceEdit, CodeAction, MockEditor };

export namespace CodeActionKind {
  export const QuickFix = 'quickfix';
  export const Refactor = 'refactor';
  export const RefactorExtract = 'refactor.extract';
  export const RefactorInline = 'refactor.inline';
  export const RefactorRewrite = 'refactor.rewrite';
  export const Source = 'source';
  export const SourceOrganizeImports = 'source.organizeImports';
  export const Empty = '';
}

export const executedCommands: { command: string; args: any[] }[] = [];

export function resetExecutedCommands() {
  executedCommands.length = 0;
}

export namespace commands {
  const registeredCommands = new Map<string, (...args: any[]) => any>();

  export function registerCommand(
    command: string,
    callback: (...args: any[]) => any
  ): Disposable {
    registeredCommands.set(command, callback);
    return {
      dispose: () => registeredCommands.delete(command)
    };
  }

  export async function executeCommand(command: string, ...args: any[]): Promise<any> {
    executedCommands.push({ command, args });

    const handler = registeredCommands.get(command);
    if (handler) {
      return await handler(...args);
    }
    return undefined;
  }
}

export namespace window {
  let _activeTextEditor: MockEditor | undefined;

  export let activeTextEditor: MockEditor | undefined;

  export function setActiveEditor(editor: MockEditor | undefined) {
    _activeTextEditor = editor;
    activeTextEditor = editor;
  }
}
