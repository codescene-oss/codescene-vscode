/* eslint-disable @typescript-eslint/naming-convention */

import { MockTextDocument } from './mock-text-document';

export async function openTextDocument(options: { content: string; language: string }) {
  return new MockTextDocument(options.content, options.language);
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
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

export namespace commands {
  export function registerCommand(command: string, callback: (...args: any[]) => any): Disposable {
    return { dispose: () => {} };
  }

  export async function executeCommand(command: string, ...args: any[]): Promise<any> {
    return undefined;
  }
}
