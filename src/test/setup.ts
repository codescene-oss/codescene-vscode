/* eslint-disable max-classes-per-file */
import Module from 'module';
import * as fs from 'fs';
import { DiagnosticStub } from './stubs/diagnostic-stub';
import { EventEmitterStub } from './stubs/event-emitter-stub';
import { RangeStub } from './stubs/range-stub';

export let enableTestLogging = false;
export function setEnableTestLogging(value: boolean) {
  enableTestLogging = value;
}

const defaultWorkspaceFolders = [
  {
    uri: { fsPath: '/Users/vemv/ext', scheme: 'file', authority: '', path: '/Users/vemv/ext', query: '', fragment: '' },
    name: 'ext',
    index: 0,
  },
];

export function mockWorkspaceFolders(workspaceFolders: any[] | undefined | null) {
  vscodeStub.workspace.workspaceFolders = workspaceFolders as any;
}

export function createMockWorkspaceFolder(fsPath: string, name: string = 'test-workspace', index: number = 0) {
  return {
    uri: { fsPath, scheme: 'file', authority: '', path: fsPath, query: '', fragment: '' },
    name,
    index,
  };
}

export function restoreDefaultWorkspaceFolders() {
  vscodeStub.workspace.workspaceFolders = defaultWorkspaceFolders as any;
}

const vscodeStub = {
  window: {
    createOutputChannel: (name: string) => ({
      append: (text: string) => enableTestLogging && process.stdout.write(`[${name}] ${text}`),
      appendLine: (text: string) => enableTestLogging && console.log(`[${name}] ${text}`),
      clear: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {},
      error: (text: string) => enableTestLogging && console.error(`[${name}] ERROR: ${text}`),
      warn: (text: string) => enableTestLogging && console.warn(`[${name}] WARN: ${text}`),
      info: (text: string) => enableTestLogging && console.log(`[${name}] INFO: ${text}`),
      debug: (text: string) => enableTestLogging && console.log(`[${name}] DEBUG: ${text}`),
      trace: (text: string) => enableTestLogging && console.log(`[${name}] TRACE: ${text}`),
    }),
    setStatusBarMessage: (text: string, timeout?: number) => ({ dispose: () => {} }),
    showErrorMessage: (message: string, ...items: any[]) => Promise.resolve(undefined),
    showInformationMessage: (message: string, ...items: any[]) => Promise.resolve(undefined),
    showWarningMessage: (message: string, ...items: any[]) => Promise.resolve(undefined),
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: () => Promise.resolve(),
  },
  workspace: {
    workspaceFolders: defaultWorkspaceFolders as any,
    createFileSystemWatcher: () => ({
      onDidCreate: () => ({ dispose: () => {} }),
      onDidChange: () => ({ dispose: () => {} }),
      onDidDelete: () => ({ dispose: () => {} }),
      dispose: () => {},
    }),
    getConfiguration: (section?: string) => ({
      get: () => undefined,
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    }),
    fs: {
      stat: async (uri: any) => {
        const fsPath = uri.fsPath || uri.path;
        return new Promise((resolve, reject) => {
          fs.stat(fsPath, (err: any, stats: any) => {
            if (err) {
              reject(err);
            } else {
              resolve({
                type: stats.isFile() ? 1 : stats.isDirectory() ? 2 : 0,
                ctime: stats.ctimeMs,
                mtime: stats.mtimeMs,
                size: stats.size,
              });
            }
          });
        });
      },
    },
  },
  languages: {
    match: (selector: any, document: any) => {
      if (!document || !document.fileName) {
        return 0;
      }
      if (Array.isArray(selector)) {
        for (const filter of selector) {
          if (filter.pattern) {
            const globPattern = filter.pattern as string;
            const match = globPattern.match(/\*\*\/\*\.(\w+)$/);
            if (match) {
              const extension = match[1];
              if (document.fileName.endsWith(`.${extension}`)) {
                return 1;
              }
            }
          }
        }
      }
      return 0;
    },
    createDiagnosticCollection: (name?: string) => ({
      name: name || 'default',
      set: () => {},
      delete: () => {},
      clear: () => {},
      forEach: () => {},
      get: () => undefined,
      has: () => false,
      dispose: () => {},
    }),
    registerCodeActionsProvider: () => ({
      dispose: () => {}
    }),
  },
  Diagnostic: DiagnosticStub,
  EventEmitter: EventEmitterStub,
  Range: RangeStub,
  Position: class Position {
    constructor(public line: number, public character: number) {}
  },
  Selection: class Selection {
    constructor(public anchor: any, public active: any) {
      this.start = anchor;
      this.end = active;
    }
    start: any;
    end: any;
  },
  WorkspaceEdit: class WorkspaceEdit {
    private changes = new Map<string, any[]>();
    insert(uri: any, position: any, newText: string): void {
      const key = uri.toString();
      if (!this.changes.has(key)) {
        this.changes.set(key, []);
      }
      this.changes.get(key)!.push({ position, newText });
    }
    get(uri: any): any[] {
      return this.changes.get(uri.toString()) || [];
    }
  },
  CodeAction: class CodeAction {
    title: string;
    kind?: string;
    diagnostics?: any[];
    edit?: any;
    command?: any;
    disabled?: any;
    constructor(title: string, kind?: string) {
      this.title = title;
      this.kind = kind;
    }
  },
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  ThemeColor: class ThemeColor {
    constructor(public id: string) {}
  },
  CodeActionKind: {
    QuickFix: 'quickfix',
    Refactor: 'refactor',
    RefactorExtract: 'refactor.extract',
    RefactorInline: 'refactor.inline',
    RefactorRewrite: 'refactor.rewrite',
    Source: 'source',
    SourceOrganizeImports: 'source.organizeImports',
    Empty: '',
  },
  Uri: {
    parse: (value: string) => ({
      scheme: 'file',
      authority: '',
      path: value,
      query: '',
      fragment: '',
      fsPath: value,
      with: () => ({}),
      toString: () => value,
      toJSON: () => ({ scheme: 'file', path: value }),
    }),
    file: (path: string) => ({
      scheme: 'file',
      authority: '',
      path,
      query: '',
      fragment: '',
      fsPath: path,
      with: () => ({}),
      toString: () => path,
      toJSON: () => ({ scheme: 'file', path }),
    }),
  },
};

const defaultGetConfiguration = vscodeStub.workspace.getConfiguration;

export function mockConfiguration(section: string, config: Record<string, any>) {
  const originalGetConfiguration = vscodeStub.workspace.getConfiguration;
  vscodeStub.workspace.getConfiguration = ((configSection?: string) => {
    if (configSection === section) {
      return {
        get: (key: string, defaultValue?: any) => {
          if (key in config) {
            return config[key];
          }
          return defaultValue;
        },
        has: () => false,
        inspect: () => undefined,
        update: () => Promise.resolve(),
      };
    }
    return originalGetConfiguration(configSection);
  }) as any;
}

export function restoreDefaultConfiguration() {
  vscodeStub.workspace.getConfiguration = defaultGetConfiguration;
}

const originalRequire = Module.prototype.require;
(Module.prototype.require as any) = function (this: any, id: string) {
  if (id === 'vscode') {
    return { ...vscodeStub, default: vscodeStub };
  }
  return originalRequire.apply(this, arguments as any);
};
