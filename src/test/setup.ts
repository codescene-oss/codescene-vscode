import Module from 'module';
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
    getConfiguration: () => ({
      get: () => undefined,
      has: () => false,
      inspect: () => undefined,
      update: () => Promise.resolve(),
    }),
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
  },
  Diagnostic: DiagnosticStub,
  EventEmitter: EventEmitterStub,
  Range: RangeStub,
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  ThemeColor: class ThemeColor {
    constructor(public id: string) {}
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

const originalRequire = Module.prototype.require;
(Module.prototype.require as any) = function (this: any, id: string) {
  if (id === 'vscode') {
    return { ...vscodeStub, default: vscodeStub };
  }
  return originalRequire.apply(this, arguments as any);
};
