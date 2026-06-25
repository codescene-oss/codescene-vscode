import Module from 'module';
import * as fs from 'fs';
import { DiagnosticStub } from './stubs/diagnostic-stub';
import { EventEmitterStub } from './stubs/event-emitter-stub';
import { RangeStub } from './stubs/range-stub';
import { PositionStub } from './stubs/position-stub';
import { SelectionStub } from './stubs/selection-stub';
import { WorkspaceEditStub } from './stubs/workspace-edit-stub';
import { CodeActionStub } from './stubs/code-action-stub';
import { ThemeColorStub } from './stubs/theme-color-stub';
import { ThemeIconStub } from './stubs/theme-icon-stub';
import { TreeItemStub } from './stubs/tree-item-stub';

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

const onDidSaveTextDocumentListeners: Array<(document: any) => void> = [];
const onDidCreateFilesListeners: Array<(event: { files: any[] }) => void> = [];
const onDidDeleteFilesListeners: Array<(event: { files: any[] }) => void> = [];
const onDidRenameFilesListeners: Array<(event: { files: Array<{ oldUri: any; newUri: any }> }) => void> = [];

let mockTextDocuments: any[] = [];
let openTextDocumentHandler: ((uriOrPath: any) => Promise<any>) | undefined;
const openTextDocumentCalls: any[] = [];

export function setMockTextDocuments(documents: any[]) {
  mockTextDocuments = documents;
}

export function resetMockTextDocuments() {
  mockTextDocuments = [];
}

export function getOpenTextDocumentCalls(): any[] {
  return openTextDocumentCalls;
}

export function setOpenTextDocumentHandler(handler: ((uriOrPath: any) => Promise<any>) | undefined) {
  openTextDocumentHandler = handler;
}

export function fireOnDidSaveTextDocument(document: any) {
  onDidSaveTextDocumentListeners.forEach((listener) => listener(document));
}

export function fireOnDidCreateFiles(files: any[]) {
  onDidCreateFilesListeners.forEach((listener) => listener({ files }));
}

export function fireOnDidDeleteFiles(files: any[]) {
  onDidDeleteFilesListeners.forEach((listener) => listener({ files }));
}

export function fireOnDidRenameFiles(files: Array<{ oldUri: any; newUri: any }>) {
  onDidRenameFilesListeners.forEach((listener) => listener({ files }));
}

export function resetWorkspaceEventListeners() {
  onDidSaveTextDocumentListeners.length = 0;
  onDidCreateFilesListeners.length = 0;
  onDidDeleteFilesListeners.length = 0;
  onDidRenameFilesListeners.length = 0;
  mockTextDocuments = [];
  openTextDocumentHandler = undefined;
  openTextDocumentCalls.length = 0;
}

let mockGitRepositories: any[] = [];

export type MockWebviewPanel = {
  visible: boolean;
  webview: {
    onDidReceiveMessage: (
      callback: (message: unknown) => void,
      thisArg?: unknown
    ) => { dispose: () => void };
    postMessage: (message: unknown) => Promise<boolean>;
    html: string;
    cspSource: string;
    asWebviewUri: (uri: { toString: () => string }) => string;
  };
  onDidDispose: (callback: () => void) => { dispose: () => void };
  dispose: () => void;
  reveal: (viewColumn?: unknown, preserveFocus?: boolean) => void;
};

let lastWebviewPanelMock: MockWebviewPanel | undefined;
let messageHandler: ((message: unknown) => void) | undefined;
let disposeHandler: (() => void) | undefined;
const postMessageCalls: unknown[] = [];

export function getLastWebviewPanelMock(): MockWebviewPanel | undefined {
  return lastWebviewPanelMock;
}

export function getWebviewMessageHandler(): ((message: unknown) => void) | undefined {
  return messageHandler;
}

export function getWebviewPostMessageCalls(): unknown[] {
  return postMessageCalls;
}

export function resetWebviewPanelMocks() {
  lastWebviewPanelMock = undefined;
  messageHandler = undefined;
  disposeHandler = undefined;
  postMessageCalls.length = 0;
}

function createMockWebviewPanel(): MockWebviewPanel {
  const panel: MockWebviewPanel = {
    visible: false,
    webview: {
      onDidReceiveMessage: (callback: (message: unknown) => void, thisArg?: unknown) => {
        messageHandler = thisArg ? callback.bind(thisArg) : callback;
        return { dispose: () => {} };
      },
      postMessage: async (message: unknown) => {
        postMessageCalls.push(message);
        return true;
      },
      html: '',
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri: { toString: () => string }) => uri.toString(),
    },
    onDidDispose: (callback: () => void) => {
      disposeHandler = callback;
      return { dispose: () => {} };
    },
    dispose: () => {
      disposeHandler?.();
    },
    reveal: () => {
      panel.visible = true;
    },
  };
  lastWebviewPanelMock = panel;
  return panel;
}

export function setMockGitRepositories(repos: any[]) {
  mockGitRepositories = repos;
}

export function clearMockGitRepositories() {
  mockGitRepositories = [];
}

function createMockGitApi() {
  return {
    repositories: mockGitRepositories,
    getRepository: (uri: { fsPath?: string; path?: string }) => {
      const fsPath = uri.fsPath || uri.path || '';
      return mockGitRepositories.find((repo) => fsPath.startsWith(repo.rootUri.fsPath)) || null;
    },
  };
}

const vscodeStub = {
  extensions: {
    getExtension: (id: string) => {
      if (id === 'vscode.git') {
        return {
          exports: {
            getAPI: (version: number) => {
              void version;
              return createMockGitApi();
            },
          },
        };
      }
      return undefined;
    },
  },
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
    registerWebviewViewProvider: (id: string, provider: any) => {
      void id;
      void provider;
      return { dispose: () => {} };
    },
    createTreeView: (id: string, opts: any) => {
      void id;
      void opts;
      return {
      badge: undefined,
      dispose: () => {},
    };
    },
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      command: '',
      backgroundColor: undefined,
      show: () => {},
      hide: () => {},
      dispose: () => {},
    }),
    createWebviewPanel: () => createMockWebviewPanel(),
  },
  ViewColumn: { Beside: 2, Active: 1, One: 1, Two: 2, Three: 3 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: () => Promise.resolve(),
  },
  workspace: {
    get textDocuments() {
      return mockTextDocuments;
    },
    openTextDocument: async (uriOrPath: any) => {
      openTextDocumentCalls.push(uriOrPath);
      if (openTextDocumentHandler) {
        return openTextDocumentHandler(uriOrPath);
      }
      throw new Error(`openTextDocument not mocked for: ${uriOrPath}`);
    },
    workspaceFolders: defaultWorkspaceFolders as any,
    onDidChangeConfiguration: (listener: any) => {
      void listener;
      return { dispose: () => {} };
    },
    onDidCloseTextDocument: (listener: any) => {
      void listener;
      return { dispose: () => {} };
    },
    onDidSaveTextDocument: (listener: any) => {
      onDidSaveTextDocumentListeners.push(listener);
      return { dispose: () => {} };
    },
    onDidCreateFiles: (listener: any) => {
      onDidCreateFilesListeners.push(listener);
      return { dispose: () => {} };
    },
    onDidDeleteFiles: (listener: any) => {
      onDidDeleteFilesListeners.push(listener);
      return { dispose: () => {} };
    },
    onDidRenameFiles: (listener: any) => {
      onDidRenameFilesListeners.push(listener);
      return { dispose: () => {} };
    },
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
    registerCodeLensProvider: () => ({
      dispose: () => {}
    }),
  },
  Diagnostic: DiagnosticStub,
  EventEmitter: EventEmitterStub,
  Range: RangeStub,
  Position: PositionStub,
  Selection: SelectionStub,
  WorkspaceEdit: WorkspaceEditStub,
  CodeAction: CodeActionStub,
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  EndOfLine: {
    LF: 1,
    CRLF: 2,
  },
  ThemeColor: ThemeColorStub,
  TreeItem: TreeItemStub,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: ThemeIconStub,
  RelativePattern: class {
    baseUri: any;
    pattern: string;
    constructor(base: any, pattern: string) {
      this.baseUri = base;
      this.pattern = pattern;
    }
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
  env: {
    appName: 'Visual Studio Code',
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
    joinPath: (base: any, ...segments: string[]) => {
      const joined = [base.toString(), ...segments].join('/');
      return {
        scheme: 'file',
        authority: '',
        path: joined,
        query: '',
        fragment: '',
        fsPath: joined,
        with: () => ({}),
        toString: () => joined,
        toJSON: () => ({ scheme: 'file', path: joined }),
      };
    },
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
