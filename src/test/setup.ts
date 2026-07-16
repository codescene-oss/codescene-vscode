import Module from 'module';
import * as fs from 'fs';
import { DiagnosticStub } from './stubs/diagnostic-stub';
import { EventEmitterStub } from './stubs/event-emitter-stub';
import { RangeStub } from './stubs/range-stub';
import { PositionStub } from './stubs/position-stub';
import { SelectionStub } from './stubs/selection-stub';
import { WorkspaceEditStub } from './stubs/workspace-edit-stub';
import { CodeActionStub } from './stubs/code-action-stub';
import { CodeLensStub } from './stubs/code-lens-stub';
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

let mockGitRepositories: any[] = [];
let mockFindFilesResults: any[] = [];

export function setMockFindFilesResults(results: any[]) {
  mockFindFilesResults = results;
}

export function clearMockFindFilesResults() {
  mockFindFilesResults = [];
}

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
    state: {
      focused: true,
    },
    onDidChangeWindowState: (listener: any) => {
      void listener;
      return { dispose: () => {} };
    },
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
    workspaceFolders: defaultWorkspaceFolders as any,
    findFiles: async () => {
      return mockFindFilesResults;
    },
    openTextDocument: async (pathOrUri: string | { fsPath: string }) => {
      const filePath = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath;
      const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
      const lines = content.split('\n');
      return {
        uri: {
          scheme: 'file',
          authority: '',
          path: filePath,
          query: '',
          fragment: '',
          fsPath: filePath,
          with: () => ({}),
          toString: () => filePath,
          toJSON: () => ({ scheme: 'file', path: filePath }),
        },
        fileName: filePath,
        isUntitled: false,
        languageId: filePath.endsWith('.ts') ? 'typescript' : filePath.endsWith('.js') ? 'javascript' : 'plaintext',
        version: 1,
        isDirty: false,
        isClosed: false,
        eol: 1,
        lineCount: lines.length,
        getText: (range?: any) => {
          if (!range) return content;
          const startLine = range.start?.line ?? 0;
          const endLine = range.end?.line ?? lines.length - 1;
          return lines.slice(startLine, endLine + 1).join('\n');
        },
        lineAt: (lineOrPosition: number | { line: number }) => {
          const lineNum = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
          const text = lines[lineNum] || '';
          return {
            lineNumber: lineNum,
            text,
            range: { start: { line: lineNum, character: 0 }, end: { line: lineNum, character: text.length } },
            rangeIncludingLineBreak: { start: { line: lineNum, character: 0 }, end: { line: lineNum + 1, character: 0 } },
            firstNonWhitespaceCharacterIndex: text.search(/\S/),
            isEmptyOrWhitespace: text.trim().length === 0,
          };
        },
        offsetAt: (position: { line: number; character: number }) => {
          let offset = 0;
          for (let i = 0; i < position.line && i < lines.length; i++) {
            offset += lines[i].length + 1;
          }
          return offset + position.character;
        },
        positionAt: (offset: number) => {
          let remaining = offset;
          for (let i = 0; i < lines.length; i++) {
            if (remaining <= lines[i].length) {
              return { line: i, character: remaining };
            }
            remaining -= lines[i].length + 1;
          }
          return { line: lines.length - 1, character: lines[lines.length - 1]?.length || 0 };
        },
        getWordRangeAtPosition: () => undefined,
        validateRange: (range: any) => range,
        validatePosition: (position: any) => position,
        save: () => Promise.resolve(true),
      };
    },
    onDidChangeConfiguration: (listener: any) => {
      void listener;
      return { dispose: () => {} };
    },
    onDidCloseTextDocument: (listener: any) => {
      void listener;
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
  CodeLens: CodeLensStub,
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  ThemeColor: ThemeColorStub,
  TreeItem: TreeItemStub,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: ThemeIconStub,
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
