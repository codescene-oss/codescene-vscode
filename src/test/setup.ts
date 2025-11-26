import Module from 'module';
import { DiagnosticStub } from './stubs/diagnostic-stub';
import { EventEmitterStub } from './stubs/event-emitter-stub';
import { RangeStub } from './stubs/range-stub';

const vscodeStub = {
  window: {
    createOutputChannel: () => ({
      append: () => {},
      appendLine: () => {},
      clear: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {},
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
      trace: () => {},
    }),
  },
  workspace: {
    workspaceFolders: undefined,
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
