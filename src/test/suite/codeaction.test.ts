import * as assert from 'assert';
import * as vscode from '../mocks/vscode';
import { TestTextDocument } from '../mocks/test-text-document';
import { CsDiagnostic } from '../../diagnostics/cs-diagnostic';
import { ReviewCodeActionProvider } from '../../review/codeaction';
import { CodeSmell } from '../../devtools-api/review-model';
import Reviewer from '../../review/reviewer';
import { CsReview } from '../../review/cs-review';
import type * as VSCode from 'vscode';
import { DevtoolsAPI } from '../../devtools-api';

let provider: ReviewCodeActionProvider;
let mockReviewCache: any;
let originalDevtoolsAPIInstance: any;

function setupTestEnvironment() {
  provider = new ReviewCodeActionProvider();
  vscode.resetExecutedCommands();

  mockReviewCache = {
    reviewMap: new Map(),
    get(document: any, skipMonitorUpdate: any) {
      return this.reviewMap.get(document.uri.toString());
    },
    set(document: any, reviewItem: any) {
      this.reviewMap.set(document.uri.toString(), reviewItem);
    }
  };

  (Reviewer as any)._instance = {
    reviewCache: mockReviewCache
  };

  originalDevtoolsAPIInstance = (DevtoolsAPI as any).instance;
  (DevtoolsAPI as any).instance = {
    preflightJson: undefined
  };
}

function teardownTestEnvironment() {
  (DevtoolsAPI as any).instance = originalDevtoolsAPIInstance;
  vscode.window.setActiveEditor(undefined);
  mockReviewCache.reviewMap.clear();
}

suite('ReviewCodeActionProvider - Disable Action', () => {
  setup(setupTestEnvironment);
  teardown(teardownTestEnvironment);

  suite('provideCodeActions - Disable Action Creation', () => {
    test('creates disable action with correct title and annotation', async () => {
      const document = new TestTextDocument(
        '/test/file.ts',
        '    const x = 1;',
        'typescript'
      );

      const diagnostic = createMockCsDiagnostic(
        new vscode.Range(
          new vscode.Position(0, 4),
          new vscode.Position(0, 15)
        ),
        'complex-conditional'
      );

      const mockReview = createMockCsReview(document, [diagnostic]);
      mockReviewCache.set(document, { review: mockReview });

      const context = { diagnostics: [diagnostic], triggerKind: 1 } as any;
      const range = diagnostic.range;

      const actions: any = await provider.provideCodeActions(document as any, range as any, context, undefined as any);

      const disableAction = actions?.find((a: any) => a.title.startsWith('Disable'));

      assert.ok(disableAction, 'Should create disable action');
      assert.strictEqual(
        disableAction.title,
        'Disable "complex-conditional" for this line'
      );
    });

    test('does not create disable action when diagnostic has no category', async () => {
      const document = new TestTextDocument(
        '/test/file.ts',
        'const x = 1;',
        'typescript'
      );

      const diagnostic = createMockCsDiagnostic(
        new vscode.Range(
          new vscode.Position(0, 0),
          new vscode.Position(0, 11)
        ),
        undefined
      );

      const mockReview = createMockCsReview(document, [diagnostic]);
      mockReviewCache.set(document, { review: mockReview });

      const context = { diagnostics: [diagnostic], triggerKind: 1 } as any;
      const range = diagnostic.range;

      const actions: any = await provider.provideCodeActions(document as any, range as any, context, undefined as any);

      const disableAction = actions?.find((a: any) => a.title.startsWith('Disable'));
      assert.ok(!disableAction, 'Should not create disable action without category');
    });

    test('does not create action when no diagnostics in range', async () => {
      const document = new TestTextDocument(
        '/test/file.ts',
        'const x = 1;',
        'typescript'
      );

      const mockReview = createMockCsReview(document, []);
      mockReviewCache.set(document, { review: mockReview });

      const context = { diagnostics: [], triggerKind: 1 } as any;
      const range = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(0, 11)
      );

      const actions = await provider.provideCodeActions(document as any, range as any, context, undefined as any);

      const disableAction = actions?.find((a: any) => a.title?.startsWith('Disable'));
      assert.ok(!disableAction, 'Should not create disable action without diagnostics');
    });
  });

  suite('provideCodeActions - WorkspaceEdit Correctness', () => {
    test('inserts annotation at correct position', async () => {
      const document = new TestTextDocument(
        '/test/file.ts',
        'const x = 1;\nconst y = 2;',
        'typescript'
      );

      const diagnostic = createMockCsDiagnostic(
        new vscode.Range(
          new vscode.Position(0, 0),
          new vscode.Position(0, 11)
        ),
        'test-category'
      );

      const disableAction = await getDisableAction(document, diagnostic);
      const changes = disableAction?.edit?.get(document.uri);

      assert.ok(changes && changes.length > 0);
      assert.strictEqual((changes[0] as any).position.line, 0);
      assert.strictEqual((changes[0] as any).position.character, 0);
    });

    test('preserves no indentation', async () => {
      await testIndentationPreservation('const x = 1;', 0, 0, 11, '@CodeScene(disable:"test-category")\n');
    });

    test('preserves 4-space indentation', async () => {
      await testIndentationPreservation('    const x = 1;', 0, 4, 15, '    @CodeScene(disable:"test-category")\n');
    });

    test('preserves tab indentation', async () => {
      await testIndentationPreservation('\t\tconst x = 1;', 0, 2, 13, '\t\t@CodeScene(disable:"test-category")\n');
    });
  });

  suite('provideCodeActions - Command Association', () => {
    test('action includes comment command with correct arguments', async () => {
      const document = new TestTextDocument(
        '/test/file.ts',
        '    const x = 1;',
        'typescript'
      );

      const diagnostic = createMockCsDiagnostic(
        new vscode.Range(
          new vscode.Position(0, 4),
          new vscode.Position(0, 15)
        ),
        'test-category'
      );

      const disableAction = await getDisableAction(document, diagnostic);

      assert.ok(disableAction?.command, 'Action should have command');
      assert.strictEqual(
        disableAction.command.command,
        'codescene.commentInsertedLine'
      );
      assert.strictEqual(disableAction.command.arguments?.length, 2);
      assert.strictEqual(
        disableAction.command.arguments?.[0].toString(),
        document.uri.toString()
      );
      assert.strictEqual(disableAction.command.arguments?.[1], 0);
    });

    test('action is associated with diagnostics', async () => {
      const document = new TestTextDocument(
        '/test/file.ts',
        'const x = 1;',
        'typescript'
      );

      const diagnostic = createMockCsDiagnostic(
        new vscode.Range(
          new vscode.Position(0, 0),
          new vscode.Position(0, 11)
        ),
        'test-category'
      );

      const disableAction = await getDisableAction(document, diagnostic);

      assert.ok(disableAction?.diagnostics);
      assert.strictEqual(disableAction.diagnostics.length, 1);
      assert.strictEqual(disableAction.diagnostics[0].codeSmell?.category, 'test-category');
    });
  });

  suite('commentInsertedLine Command Handler', () => {
    test('selects and comments line when editor matches', async () => {
      const document = new TestTextDocument(
        '/test/file.ts',
        '    @CodeScene(disable:"test")\n    const x = 1;',
        'typescript'
      );

      const editor = new vscode.MockEditor(document);
      vscode.window.setActiveEditor(editor);
      vscode.resetExecutedCommands();

      registerCommentInsertedLineCommand();

      await vscode.commands.executeCommand(
        'codescene.commentInsertedLine',
        document.uri,
        0
      );

      assert.strictEqual(editor.selection.start.line, 0);
      assert.strictEqual(editor.selection.start.character, 0);
      assert.strictEqual(editor.selection.end.line, 0);

      const commentCmd = findCommentCommand();
      assert.ok(commentCmd, 'Should execute comment command');
    });

    test('returns early when no active editor', async () => {
      const document = new TestTextDocument(
        '/test/file.ts',
        'const x = 1;',
        'typescript'
      );

      vscode.window.setActiveEditor(undefined);
      vscode.resetExecutedCommands();
      registerCommentInsertedLineCommand();

      await vscode.commands.executeCommand(
        'codescene.commentInsertedLine',
        document.uri,
        0
      );

      const commentCmd = findCommentCommand();
      assert.ok(!commentCmd, 'Should not execute comment without active editor');
    });

    test('returns early when editor URI does not match', async () => {
      const document1 = new TestTextDocument('/test/file1.ts', 'x', 'typescript');
      const document2 = new TestTextDocument('/test/file2.ts', 'y', 'typescript');

      const editor = new vscode.MockEditor(document1);
      vscode.window.setActiveEditor(editor);
      vscode.resetExecutedCommands();
      registerCommentInsertedLineCommand();

      await vscode.commands.executeCommand(
        'codescene.commentInsertedLine',
        document2.uri,
        0
      );

      const commentCmd = findCommentCommand();
      assert.ok(!commentCmd, 'Should not execute comment when URIs mismatch');
    });
  });
});

function createMockCsDiagnostic(
  range: vscode.Range,
  category?: string
): CsDiagnostic {
  const codeSmell: CodeSmell | undefined = category ? {
    category,
    details: 'test details',
    'highlight-range': {
      'start-line': range.start.line + 1,
      'start-column': range.start.character + 1,
      'end-line': range.end.line + 1,
      'end-column': range.end.character + 1
    }
  } : undefined;

  return new CsDiagnostic(
    range as any,
    'test message',
    vscode.DiagnosticSeverity.Warning,
    codeSmell
  );
}

function createMockCsReview(
  document: TestTextDocument,
  diagnostics: CsDiagnostic[]
): CsReview {
  const fileCodeSmells: CodeSmell[] = diagnostics
    .map(d => d.codeSmell)
    .filter((cs): cs is CodeSmell => cs !== undefined);

  const reviewResult = Promise.resolve({
    score: 8.5,
    'raw-score': 'base64encodeddata',
    'file-level-code-smells': fileCodeSmells,
    'function-level-code-smells': []
  });

  return new CsReview(document as any, reviewResult);
}

async function getDisableAction(document: TestTextDocument, diagnostic: CsDiagnostic) {
  const mockReview = createMockCsReview(document, [diagnostic]);
  mockReviewCache.set(document, { review: mockReview });

  const context = { diagnostics: [diagnostic], triggerKind: 1 } as any;
  const actions: any = await provider.provideCodeActions(
    document as any,
    diagnostic.range as any,
    context,
    undefined as any
  );

  return actions?.find((a: any) => a.title.startsWith('Disable'));
}

async function testIndentationPreservation(
  code: string,
  line: number,
  startChar: number,
  endChar: number,
  expectedText: string
) {
  const document = new TestTextDocument('/test/file.ts', code, 'typescript');
  const diagnostic = createMockCsDiagnostic(
    new vscode.Range(
      new vscode.Position(line, startChar),
      new vscode.Position(line, endChar)
    ),
    'test-category'
  );

  const disableAction = await getDisableAction(document, diagnostic);
  const changes = disableAction?.edit?.get(document.uri);

  assert.strictEqual((changes?.[0] as any).newText, expectedText);
}

function registerCommentInsertedLineCommand() {
  const handler = async (documentUri: vscode.Uri, lineNumber: number) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== documentUri.toString()) {
      return;
    }

    const position = new vscode.Position(lineNumber, 0);
    const line = editor.document.lineAt(lineNumber);
    editor.selection = new vscode.Selection(
      position,
      new vscode.Position(lineNumber, line.text.length)
    );

    await vscode.commands.executeCommand('editor.action.addCommentLine');
  };

  vscode.commands.registerCommand('codescene.commentInsertedLine', handler);
}

function findCommentCommand() {
  return vscode.executedCommands.find(
    (c: { command: string; args: any[] }) => c.command === 'editor.action.addCommentLine'
  );
}
