import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import Telemetry from '../../telemetry';
import { DevtoolsAPI } from '../../devtools-api';
import { RefactoringRequest } from '../../refactoring/request';
import { FnToRefactor, RefactorResponse } from '../../devtools-api/refactor-models';
import { TestTextDocument } from '../mocks/test-text-document';
import { AgentTimeoutError } from '../../refactoring/agent-process';
import { MissingAuthTokenError } from '../../missing-auth-token-error';
import { DevtoolsError } from '../../devtools-api/devtools-error';
import { AbortError } from '../../devtools-api/abort-error';
import { failureReason, logAiStage } from '../../refactoring/ai-telemetry';
import { mockConfiguration, restoreDefaultConfiguration, setMockGitRepositories, clearMockGitRepositories, setMockExtensionForTelemetry, resetMockExtensionForTelemetry, getWebviewMessageHandler, resetWebviewPanelMocks } from '../setup';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { CsExtensionState } from '../../cs-extension-state';
import { FixGoalTarget, ScoreGoalTarget } from '../../refactoring/agent-types';
import { testConnectivity } from '../../refactoring/connectivity';
import { runGoalFix, UNDO_GOAL_FIX } from '../../refactoring/goal-fix';
import { CsRefactoringCommands } from '../../refactoring/commands';

const fnBody = 'function testFn() {}';

function testDocument(filePath = path.normalize('/workspace/test.ts'), content = fnBody): TestTextDocument {
  return new TestTextDocument(filePath, content, 'typescript');
}

suite('AI Telemetry Test Suite', () => {
  suite('failure reason', () => {
    const testCases: Array<{ name: string; error: unknown; expected: string }> = [
      { name: 'AgentTimeoutError', error: new AgentTimeoutError(60000), expected: 'timeout' },
      { name: 'MissingAuthTokenError', error: new MissingAuthTokenError(), expected: 'auth' },
      { name: 'DevtoolsError 401', error: new DevtoolsError({ message: 'Unauthorized', status: 401 }), expected: 'auth' },
      { name: 'DevtoolsError 403', error: new DevtoolsError({ message: 'Forbidden', status: 403 }), expected: 'auth' },
      { name: 'offline error', error: new Error('java.net.ConnectException'), expected: 'offline' },
      { name: 'generic Error', error: new Error('Something went wrong'), expected: 'agent-error' },
    ];

    testCases.forEach(({ name, error, expected }) => {
      test(name, () => {
        const reason = failureReason(error);
        assert.strictEqual(reason, expected);

        if (error instanceof Error) {
          const reasonData = { reason };
          assert.ok(!('message' in reasonData), 'reason data should not contain message');
          assert.ok(!('stack' in reasonData), 'reason data should not contain stack');
        }
      });
    });
  });

  suite('AI run stages', () => {
    let capturedEvents: any[] = [];
    let originalPostRefactoring: any;
    let originalInstance: any;
    let originalStateProperties: PropertyDescriptor | undefined;
    let originalIdeServer: any;
    let extension: any;

    function createMockFnToRefactor(body: string = 'function testFn() {}'): FnToRefactor {
      return {
        name: 'testFn',
        body,
        'file-type': 'typescript',
        range: { 'start-line': 1, 'start-column': 1, 'end-line': 10, 'end-column': 1 },
        'refactoring-targets': [{ category: 'Complex Method', line: 1 }],
        vscodeRange: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, body.length)),
      };
    }

    function createMockGoal(repoRoot: string = '/test/repo'): FixGoalTarget {
      return {
        goalId: 123,
        repoRoot,
        path: 'test.ts',
        metricId: 'test-metric',
        operator: '>=',
        target: 7.0,
        baseline: 5.0,
      } as ScoreGoalTarget;
    }

    setup(() => {
      mockConfiguration('codescene', { enableTelemetry: true });
      capturedEvents = [];

      originalStateProperties = Object.getOwnPropertyDescriptor(CsExtensionState, 'stateProperties');
      Object.defineProperty(CsExtensionState, 'stateProperties', {
        get: () => ({
          auth: { active: true, status: null },
          features: { analysis: { state: 'enabled' }, ace: { state: 'enabled' } },
        }),
        configurable: true,
      });

      originalIdeServer = (DevtoolsAPI as any).ideServer;
      (DevtoolsAPI as any).ideServer = {
        telemetry: async (event: any) => {
          capturedEvents.push(event);
          return { status: 200 };
        },
      };

      originalInstance = (Telemetry as any)._instance;
      (Telemetry as any).sessionId = 'test-session-id';
      extension = { id: 'codescene.codescene-vscode', packageJSON: { version: '1.0.0' } };
      setMockExtensionForTelemetry(extension);
      Telemetry.resetForTests();
      (Telemetry as any)._instance = new Telemetry(extension as any);

      originalPostRefactoring = DevtoolsAPI.postRefactoring;
    });

    teardown(() => {
      DevtoolsAPI.postRefactoring = originalPostRefactoring;
      (DevtoolsAPI as any).ideServer = originalIdeServer;
      (Telemetry as any)._instance = originalInstance;
      if (originalStateProperties) {
        Object.defineProperty(CsExtensionState, 'stateProperties', originalStateProperties);
      }
      restoreDefaultConfiguration();
      resetMockExtensionForTelemetry();
      clearMockGitRepositories();
    });

    const features: Array<{ name: string; hasGoal: boolean }> = [
      { name: 'refactor', hasGoal: false },
      { name: 'fix-task', hasGoal: true },
    ];

    features.forEach(({ name, hasGoal }) => {
      suite(name, () => {
        test('requested then agent-invoked then suggestion-produced', async () => {
          const doc = testDocument();
          const fnToRefactor = createMockFnToRefactor();
          const goal = hasGoal ? createMockGoal() : undefined;

          DevtoolsAPI.postRefactoring = async () => {
            return {
              code: 'refactored code',
              confidence: { level: 3, 'recommended-action': { description: 'test', details: 'test' }, title: 'test' },
              metadata: { 'cached?': false },
              reasons: [],
              'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
              'trace-id': 'test-trace-id',
            };
          };

          const request = new RefactoringRequest(fnToRefactor, doc, false, goal);
          request.source = 'test-source';

          logAiStage(request, 'requested');
          await request.promise;

          assert.strictEqual(capturedEvents.length, 3);
          assert.strictEqual(capturedEvents[0]['event-name'], `vscode/ai/${name}/requested`);
          assert.strictEqual(capturedEvents[1]['event-name'], `vscode/ai/${name}/agent-invoked`);
          assert.strictEqual(capturedEvents[2]['event-name'], `vscode/ai/${name}/suggestion-produced`);

          const traceId = capturedEvents[0]['trace-id'];
          assert.ok(traceId, 'trace-id should be present');
          assert.strictEqual(capturedEvents[0]['trace-id'], traceId);
          assert.strictEqual(capturedEvents[1]['trace-id'], traceId);
          assert.strictEqual(capturedEvents[2]['trace-id'], traceId);
          assert.strictEqual(capturedEvents[0].source, 'test-source');
        });

        test('no-suggestion when the code is unchanged', async () => {
          const originalCode = 'function testFn() {}';
          const doc = testDocument(undefined, originalCode);
          const fnToRefactor = createMockFnToRefactor(originalCode);
          const goal = hasGoal ? createMockGoal() : undefined;

          DevtoolsAPI.postRefactoring = async () => {
            return {
              code: originalCode,
              confidence: { level: 3, 'recommended-action': { description: 'test', details: 'test' }, title: 'test' },
              metadata: { 'cached?': false },
              reasons: [],
              'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
              'trace-id': 'test-trace-id',
            };
          };

          const request = new RefactoringRequest(fnToRefactor, doc, false, goal);
          logAiStage(request, 'requested');
          await request.promise;

          assert.strictEqual(capturedEvents.length, 3);
          assert.strictEqual(capturedEvents[2]['event-name'], `vscode/ai/${name}/no-suggestion`);
        });

        test('cancelled on abort', async () => {
          const doc = testDocument();
          const fnToRefactor = createMockFnToRefactor();
          const goal = hasGoal ? createMockGoal() : undefined;

          DevtoolsAPI.postRefactoring = async (request: RefactoringRequest) => {
            return new Promise<RefactorResponse>((resolve, reject) => {
              request.signal.addEventListener('abort', () => {
                reject(new AbortError());
              });
              setTimeout(() => resolve({} as RefactorResponse), 100);
            });
          };

          const request = new RefactoringRequest(fnToRefactor, doc, false, goal);
          logAiStage(request, 'requested');

          setTimeout(() => request.abort(), 10);

          try {
            await request.promise;
            assert.fail('Should have thrown AbortError');
          } catch (e) {
            assert.ok(e instanceof AbortError);
          }

          assert.strictEqual(capturedEvents.length, 3);
          assert.strictEqual(capturedEvents[2]['event-name'], `vscode/ai/${name}/cancelled`);
        });

        test('failed with reason on error', async () => {
          const doc = testDocument();
          const fnToRefactor = createMockFnToRefactor();
          const goal = hasGoal ? createMockGoal() : undefined;

          DevtoolsAPI.postRefactoring = async () => {
            throw new AgentTimeoutError(60000);
          };

          const request = new RefactoringRequest(fnToRefactor, doc, false, goal);
          logAiStage(request, 'requested');

          try {
            await request.promise;
            assert.fail('Should have thrown AgentTimeoutError');
          } catch (e) {
            assert.ok(e instanceof AgentTimeoutError);
          }

          assert.strictEqual(capturedEvents.length, 3);
          assert.strictEqual(capturedEvents[2]['event-name'], `vscode/ai/${name}/failed`);
          assert.strictEqual(capturedEvents[2].reason, 'timeout');
          assert.ok(!capturedEvents[2].message, 'failed event should not contain error message');
          assert.ok(!capturedEvents[2].stack, 'failed event should not contain error stack');
        });

        test('agent-invoked once when the promise is read twice', async () => {
          const doc = testDocument();
          const fnToRefactor = createMockFnToRefactor();
          const goal = hasGoal ? createMockGoal() : undefined;

          DevtoolsAPI.postRefactoring = async () => {
            return {
              code: 'refactored code',
              confidence: { level: 3, 'recommended-action': { description: 'test', details: 'test' }, title: 'test' },
              metadata: { 'cached?': false },
              reasons: [],
              'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
              'trace-id': 'test-trace-id',
            };
          };

          const request = new RefactoringRequest(fnToRefactor, doc, false, goal);
          logAiStage(request, 'requested');

          const promise1 = request.promise;
          const promise2 = request.promise;
          await promise1;
          await promise2;

          const agentInvokedEvents = capturedEvents.filter((e) => e['event-name'] === `vscode/ai/${name}/agent-invoked`);
          assert.strictEqual(agentInvokedEvents.length, 1);
        });
      });
    });

    test('no-suggestion when the goal outcome is unable (fix-task)', async () => {
      const doc = testDocument();
      const fnToRefactor = createMockFnToRefactor();
      const goal = createMockGoal();

      DevtoolsAPI.postRefactoring = async () => {
        return {
          code: 'some code',
          confidence: { level: 3, 'recommended-action': { description: 'test', details: 'test' }, title: 'test' },
          metadata: { 'cached?': false },
          reasons: [],
          'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
          'trace-id': 'test-trace-id',
          'goal-outcome': 'unable',
        };
      };

      const request = new RefactoringRequest(fnToRefactor, doc, false, goal);
      logAiStage(request, 'requested');
      await request.promise;

      assert.strictEqual(capturedEvents.length, 3);
      assert.strictEqual(capturedEvents[2]['event-name'], 'vscode/ai/fix-task/no-suggestion');
    });

    test('all stages share one trace-id', async () => {
      const doc = testDocument();
      const fnToRefactor = createMockFnToRefactor();

      DevtoolsAPI.postRefactoring = async () => {
        return {
          code: 'refactored code',
          confidence: { level: 3, 'recommended-action': { description: 'test', details: 'test' }, title: 'test' },
          metadata: { 'cached?': false },
          reasons: [],
          'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
          'trace-id': 'test-trace-id',
        };
      };

      const request = new RefactoringRequest(fnToRefactor, doc);
      logAiStage(request, 'requested');
      await request.promise;

      const traceIds = capturedEvents.map((e) => e['trace-id']);
      assert.ok(traceIds.every((id) => id === traceIds[0]), 'All events should share the same trace-id');
    });

    test('a retry is a new run with source retry and a new trace-id', async () => {
      const doc = testDocument();
      const fnToRefactor = createMockFnToRefactor();

      DevtoolsAPI.postRefactoring = async () => {
        return {
          code: 'refactored code',
          confidence: { level: 3, 'recommended-action': { description: 'test', details: 'test' }, title: 'test' },
          metadata: { 'cached?': false },
          reasons: [],
          'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
          'trace-id': 'test-trace-id',
        };
      };

      const request1 = new RefactoringRequest(fnToRefactor, doc, false);
      request1.source = 'initial';
      logAiStage(request1, 'requested');
      await request1.promise;

      const firstTraceId = capturedEvents[0]['trace-id'];

      capturedEvents = [];

      const request2 = new RefactoringRequest(fnToRefactor, doc, true);
      request2.source = 'retry';
      logAiStage(request2, 'requested');
      await request2.promise;

      const secondTraceId = capturedEvents[0]['trace-id'];

      assert.notStrictEqual(firstTraceId, secondTraceId, 'Retry should have a new trace-id');
      assert.strictEqual(capturedEvents[0].source, 'retry');
      assert.strictEqual(capturedEvents[0]['skip-cache'], true);
    });

    test('the repository root is the goal\'s root for fix-task and the document\'s repository for refactor', async () => {
      const goalRepoRoot = path.normalize('/goal/repo');
      const docRepoRoot = path.normalize('/doc/repo');

      setMockGitRepositories([
        {
          rootUri: { fsPath: docRepoRoot },
          state: { remotes: [] },
          inputBox: { value: '' },
        },
      ]);

      const doc = testDocument(path.join(docRepoRoot, 'test.ts'));
      const fnToRefactor = createMockFnToRefactor();

      DevtoolsAPI.postRefactoring = async () => {
        return {
          code: 'refactored code',
          confidence: { level: 3, 'recommended-action': { description: 'test', details: 'test' }, title: 'test' },
          metadata: { 'cached?': false },
          reasons: [],
          'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
          'trace-id': 'test-trace-id',
        };
      };

      const refactorRequest = new RefactoringRequest(fnToRefactor, doc);
      logAiStage(refactorRequest, 'requested');
      await refactorRequest.promise;

      assert.deepStrictEqual(
        capturedEvents.map((e) => e['repository-paths']),
        [[docRepoRoot], [docRepoRoot], [docRepoRoot]],
        'every refactor stage should use the document repository'
      );

      capturedEvents = [];

      const goal = createMockGoal(goalRepoRoot);
      const fixTaskRequest = new RefactoringRequest(fnToRefactor, doc, false, goal);
      logAiStage(fixTaskRequest, 'requested');
      await fixTaskRequest.promise;

      assert.deepStrictEqual(
        capturedEvents.map((e) => e['repository-paths']),
        [[goalRepoRoot], [goalRepoRoot], [goalRepoRoot]],
        'every fix-task stage should use the goal repository'
      );
    });

    test('no repository omits repository-paths', async () => {
      clearMockGitRepositories();

      const doc = testDocument();
      const fnToRefactor = createMockFnToRefactor();

      DevtoolsAPI.postRefactoring = async () => {
        return {
          code: 'refactored code',
          confidence: { level: 3, 'recommended-action': { description: 'test', details: 'test' }, title: 'test' },
          metadata: { 'cached?': false },
          reasons: [],
          'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
          'trace-id': 'test-trace-id',
        };
      };

      const request = new RefactoringRequest(fnToRefactor, doc);
      logAiStage(request, 'requested');
      await request.promise;

      capturedEvents.forEach((event) => {
        assert.ok(!('repository-paths' in event), 'Events without repository should omit repository-paths field');
      });
    });
  });

  suite('refactor panel', () => {
    let capturedEvents: any[] = [];
    let originalPostRefactoring: any;
    let originalInstance: any;
    let originalStateProperties: PropertyDescriptor | undefined;
    let originalIdeServer: any;
    let extension: any;
    let panel: any;
    let refactoringCommands: CsRefactoringCommands;
    const originalExecuteCommand = vscode.commands.executeCommand;

    function createMockFnToRefactor(body: string = 'function testFn() {}'): FnToRefactor {
      return {
        name: 'testFn',
        body,
        'file-type': 'typescript',
        range: { 'start-line': 1, 'start-column': 1, 'end-line': 10, 'end-column': 1 },
        'refactoring-targets': [{ category: 'Complex Method', line: 1 }],
        vscodeRange: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, body.length)),
      };
    }

    setup(() => {
      mockConfiguration('codescene', { enableTelemetry: true });
      capturedEvents = [];
      resetWebviewPanelMocks();

      const context = createMockExtensionContext('/test/refactor-panel');
      CsExtensionState.init(context);

      originalStateProperties = Object.getOwnPropertyDescriptor(CsExtensionState, 'stateProperties');
      Object.defineProperty(CsExtensionState, 'stateProperties', {
        get: () => ({
          auth: { active: true, status: null },
          features: { analysis: { state: 'enabled' }, ace: { state: 'enabled' } },
        }),
        configurable: true,
      });

      originalIdeServer = (DevtoolsAPI as any).ideServer;
      (DevtoolsAPI as any).ideServer = {
        telemetry: async (event: any) => {
          capturedEvents.push(event);
          return { status: 200 };
        },
      };

      originalInstance = (Telemetry as any)._instance;
      (Telemetry as any).sessionId = 'test-session-id';
      extension = { id: 'codescene.codescene-vscode', packageJSON: { version: '1.0.0' } };
      setMockExtensionForTelemetry(extension);
      Telemetry.resetForTests();
      (Telemetry as any)._instance = new Telemetry(extension as any);

      originalPostRefactoring = DevtoolsAPI.postRefactoring;
      DevtoolsAPI.postRefactoring = async () => {
        return {
          code: 'refactored code',
          confidence: { level: 3, 'recommended-action': { description: 'test', details: 'test' }, title: 'test' },
          metadata: { 'cached?': false },
          reasons: [],
          'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
          'trace-id': 'test-trace-id',
        };
      };

      refactoringCommands = new CsRefactoringCommands();
      vscode.commands.executeCommand = ((command: string, ...args: any[]) => {
        if (command === 'codescene.applyRefactoring') return (refactoringCommands as any).applyRefactoringCmd(...args);
        if (command === 'codescene.showDiffForRefactoring') return (refactoringCommands as any).showDiffForRefactoringCmd(...args);
        return Promise.resolve(undefined);
      }) as typeof vscode.commands.executeCommand;
    });

    teardown(() => {
      if (panel) {
        panel.dispose();
        panel = undefined;
      }
      vscode.commands.executeCommand = originalExecuteCommand;
      refactoringCommands.dispose();
      DevtoolsAPI.postRefactoring = originalPostRefactoring;
      (DevtoolsAPI as any).ideServer = originalIdeServer;
      (Telemetry as any)._instance = originalInstance;
      if (originalStateProperties) {
        Object.defineProperty(CsExtensionState, 'stateProperties', originalStateProperties);
      }
      restoreDefaultConfiguration();
      resetMockExtensionForTelemetry();
      clearMockGitRepositories();
      resetWebviewPanelMocks();
    });

    test('presented once per run, also after a staleness re-render', async () => {
      const { CodeSceneCWFAceTabPanel: panelClass } = await import('../../codescene-tab/webview/ace/cwf-webview-ace-panel');
      const doc = testDocument();
      const fnToRefactor = createMockFnToRefactor();
      const request = new RefactoringRequest(fnToRefactor, doc);

      panelClass.show(request);
      panel = panelClass.instance;

      await new Promise((resolve) => setTimeout(resolve, 100));

      const presentedEvents = capturedEvents.filter((e) => e['event-name']?.includes('/presented'));
      assert.strictEqual(presentedEvents.length, 1, 'Should emit presented once');

      capturedEvents = [];

      await (panel as any).updateWebView(request);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const presentedAfterRender = capturedEvents.filter((e) => e['event-name']?.includes('/presented'));
      assert.strictEqual(presentedAfterRender.length, 0, 'Should not emit presented again on staleness re-render');
    });

    test('no-suggestion is not presented', async () => {
      const { CodeSceneCWFAceTabPanel: panelClass } = await import('../../codescene-tab/webview/ace/cwf-webview-ace-panel');
      const originalCode = 'function testFn() {}';
      const doc = testDocument(undefined, originalCode);
      const fnToRefactor = createMockFnToRefactor(originalCode);

      DevtoolsAPI.postRefactoring = async () => {
        return {
          code: originalCode,
          confidence: { level: 3, 'recommended-action': { description: 'test', details: 'test' }, title: 'test' },
          metadata: { 'cached?': false },
          reasons: [],
          'refactoring-properties': { 'added-code-smells': [], 'removed-code-smells': [] },
          'trace-id': 'test-trace-id',
        };
      };

      const request = new RefactoringRequest(fnToRefactor, doc);
      panelClass.show(request);
      panel = panelClass.instance;

      await new Promise((resolve) => setTimeout(resolve, 100));

      const presentedEvents = capturedEvents.filter((e) => e['event-name']?.includes('/presented'));
      assert.strictEqual(presentedEvents.length, 0, 'Should not emit presented for no-suggestion');
    });

    test('diff-shown and copied fire on every action', async () => {
      const { CodeSceneCWFAceTabPanel: panelClass } = await import('../../codescene-tab/webview/ace/cwf-webview-ace-panel');
      const doc = testDocument();
      const fnToRefactor = createMockFnToRefactor();
      const request = new RefactoringRequest(fnToRefactor, doc);

      panelClass.show(request);
      panel = panelClass.instance;

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handler = getWebviewMessageHandler();
      assert.ok(handler, 'Message handler should be set');

      capturedEvents = [];

      handler!({ messageType: 'showDiff' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      let diffShownEvents = capturedEvents.filter((e) => e['event-name']?.includes('/diff-shown'));
      assert.strictEqual(diffShownEvents.length, 1, 'Should emit diff-shown on first action');

      handler!({ messageType: 'showDiff' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      diffShownEvents = capturedEvents.filter((e) => e['event-name']?.includes('/diff-shown'));
      assert.strictEqual(diffShownEvents.length, 2, 'Should emit diff-shown on second action');

      handler!({ messageType: 'copyCode', payload: { code: 'test code' } });
      await new Promise((resolve) => setTimeout(resolve, 10));

      const copiedEvents = capturedEvents.filter((e) => e['event-name']?.includes('/copied'));
      assert.strictEqual(copiedEvents.length, 1, 'Should emit copied on first action');

      handler!({ messageType: 'copyCode', payload: { code: 'test code' } });
      await new Promise((resolve) => setTimeout(resolve, 10));

      const copiedEvents2 = capturedEvents.filter((e) => e['event-name']?.includes('/copied'));
      assert.strictEqual(copiedEvents2.length, 2, 'Should emit copied on second action');
    });

    test('apply emits applied', async () => {
      const { CodeSceneCWFAceTabPanel: panelClass } = await import('../../codescene-tab/webview/ace/cwf-webview-ace-panel');
      const doc = testDocument();
      const fnToRefactor = createMockFnToRefactor();
      const request = new RefactoringRequest(fnToRefactor, doc);

      panelClass.show(request);
      panel = panelClass.instance;

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handler = getWebviewMessageHandler();
      assert.ok(handler, 'Message handler should be set');

      capturedEvents = [];

      handler!({ messageType: 'apply' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const appliedEvents = capturedEvents.filter((e) => e['event-name']?.includes('/applied'));
      assert.strictEqual(appliedEvents.length, 1, 'Should emit applied');
    });

    test('reject emits discarded', async () => {
      const { CodeSceneCWFAceTabPanel: panelClass } = await import('../../codescene-tab/webview/ace/cwf-webview-ace-panel');
      const doc = testDocument();
      const fnToRefactor = createMockFnToRefactor();
      const request = new RefactoringRequest(fnToRefactor, doc);

      panelClass.show(request);
      panel = panelClass.instance;

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handler = getWebviewMessageHandler();
      assert.ok(handler, 'Message handler should be set');

      capturedEvents = [];

      handler!({ messageType: 'reject' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      const discardedEvents = capturedEvents.filter((e) => e['event-name']?.includes('/discarded'));
      assert.strictEqual(discardedEvents.length, 1, 'Should emit discarded');
    });

    test('close emits nothing', async () => {
      const { CodeSceneCWFAceTabPanel: panelClass } = await import('../../codescene-tab/webview/ace/cwf-webview-ace-panel');
      const doc = testDocument();
      const fnToRefactor = createMockFnToRefactor();
      const request = new RefactoringRequest(fnToRefactor, doc);

      panelClass.show(request);
      panel = panelClass.instance;

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handler = getWebviewMessageHandler();
      assert.ok(handler, 'Message handler should be set');

      capturedEvents = [];

      handler!({ messageType: 'close' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      const closeEvents = capturedEvents.filter((e) => e['event-name']?.includes('/close'));
      assert.strictEqual(closeEvents.length, 0, 'Close should not emit any events');
    });
  });

  test('the connectivity test emits no AI event', async () => {
    let capturedEvents: any[] = [];
    const originalTelemetry = (DevtoolsAPI as any).ideServer;
    const originalInstance = (Telemetry as any)._instance;

    (DevtoolsAPI as any).ideServer = {
      telemetry: async (event: any) => {
        capturedEvents.push(event);
        return { status: 200 };
      },
    };

    mockConfiguration('codescene', { enableTelemetry: true });
    const extension = { id: 'codescene.codescene-vscode', packageJSON: { version: '1.0.0' } };
    setMockExtensionForTelemetry(extension);
    Telemetry.resetForTests();
    (Telemetry as any)._instance = new Telemetry(extension as any);

    try {
      try {
        await testConnectivity({ timeoutMs: 500 });
      } catch {
        // Ignore connectivity test failures
      }

      const aiEvents = capturedEvents.filter((e) => e['event-name']?.includes('/ai/'));
      assert.strictEqual(aiEvents.length, 0, 'Connectivity test should not emit any AI events');
    } finally {
      (DevtoolsAPI as any).ideServer = originalTelemetry;
      (Telemetry as any)._instance = originalInstance;
      resetMockExtensionForTelemetry();
      restoreDefaultConfiguration();
    }
  });

  suite('fix-task', () => {
    let capturedEvents: any[] = [];
    let originalPostRefactoring: any;
    let originalInstance: any;
    let originalStateProperties: PropertyDescriptor | undefined;
    let originalIdeServer: any;
    let extension: any;
    let document: TestTextDocument;
    let pending: Array<{ resolve: (response: RefactorResponse) => void; reject: (error: Error) => void; request: RefactoringRequest }>;
    let infos: Array<{ message: string; items: string[] }>;
    let warnings: string[];
    let infoAnswer: Promise<string | undefined>;
    let saved: string[];
    let shown: any[];
    let originalWindow: Record<string, unknown>;

    const original = 'function testFn() {}';
    const fixed = 'function testFn() { return 42; }';

    function createMockFnToRefactor(body: string = original): FnToRefactor {
      return {
        name: 'testFn',
        body,
        'file-type': 'typescript',
        range: { 'start-line': 1, 'start-column': 1, 'end-line': 10, 'end-column': 1 },
        'refactoring-targets': [{ category: 'Complex Method', line: 1 }],
        vscodeRange: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, body.length)),
      };
    }

    function createMockGoal(repoRoot: string = '/test/repo'): FixGoalTarget {
      return {
        goalId: 123,
        repoRoot,
        path: 'test.ts',
        metricId: 'test-metric',
        operator: '>=',
        target: 7.0,
        baseline: 5.0,
      } as any;
    }

    function responseWith(code: string, outcome: 'reached' | 'improved' | 'unable' = 'reached'): RefactorResponse {
      return {
        code,
        confidence: { level: 3, title: 'Goal reached', 'recommended-action': { description: '', details: 'Goal reached' } },
        reasons: [],
        'refactoring-properties': { 'removed-code-smells': [], 'added-code-smells': [] },
        metadata: { 'cached?': false },
        'trace-id': 'test-trace-id',
        'goal-outcome': outcome,
      };
    }

    setup(() => {
      mockConfiguration('codescene', { enableTelemetry: true });
      capturedEvents = [];
      pending = [];
      infos = [];
      warnings = [];
      saved = [];
      shown = [];
      infoAnswer = Promise.resolve(undefined);

      document = testDocument(path.join('/test/repo', 'test.ts'), original);
      document.setOnSave(() => {
        const applied = document.getText();
        saved.push(applied);
      });

      originalStateProperties = Object.getOwnPropertyDescriptor(CsExtensionState, 'stateProperties');
      Object.defineProperty(CsExtensionState, 'stateProperties', {
        get: () => ({
          auth: { active: true, status: null },
          features: { analysis: { state: 'enabled' }, ace: { state: 'enabled' } },
        }),
        configurable: true,
      });

      originalIdeServer = (DevtoolsAPI as any).ideServer;
      (DevtoolsAPI as any).ideServer = {
        telemetry: async (event: any) => {
          capturedEvents.push(event);
          return { status: 200 };
        },
      };

      originalInstance = (Telemetry as any)._instance;
      (Telemetry as any).sessionId = 'test-session-id';
      extension = { id: 'codescene.codescene-vscode', packageJSON: { version: '1.0.0' } };
      setMockExtensionForTelemetry(extension);
      Telemetry.resetForTests();
      (Telemetry as any)._instance = new Telemetry(extension as any);

      originalPostRefactoring = DevtoolsAPI.postRefactoring;
      DevtoolsAPI.postRefactoring = (request: RefactoringRequest) =>
        new Promise<RefactorResponse>((resolve, reject) => pending.push({ resolve, reject, request }));

      const window = (vscode as any).window;
      originalWindow = {
        showInformationMessage: window.showInformationMessage,
        showWarningMessage: window.showWarningMessage,
        showTextDocument: window.showTextDocument,
      };
      window.showInformationMessage = (message: string, ...items: string[]) => {
        infos.push({ message, items });
        return infoAnswer;
      };
      window.showWarningMessage = async (message: string) => {
        warnings.push(message);
        return undefined;
      };
      window.showTextDocument = async (doc: any) => {
        shown.push(doc);
        return undefined;
      };
    });

    teardown(() => {
      Object.assign((vscode as any).window, originalWindow);
      DevtoolsAPI.postRefactoring = originalPostRefactoring;
      (DevtoolsAPI as any).ideServer = originalIdeServer;
      (Telemetry as any)._instance = originalInstance;
      if (originalStateProperties) {
        Object.defineProperty(CsExtensionState, 'stateProperties', originalStateProperties);
      }
      restoreDefaultConfiguration();
      resetMockExtensionForTelemetry();
      clearMockGitRepositories();
    });

    async function flushPromises(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    test('auto-apply emits applied with outcome', async () => {
      const fnToRefactor = createMockFnToRefactor();
      const goal = createMockGoal();
      const request = new RefactoringRequest(fnToRefactor, document, false, goal);

      const run = runGoalFix(request);
      await flushPromises();

      pending[0].resolve(responseWith(fixed, 'reached'));
      await run;

      const appliedEvents = capturedEvents.filter((e) => e['event-name'] === 'vscode/ai/fix-task/applied');
      assert.strictEqual(appliedEvents.length, 1, 'Should emit applied once');
      assert.strictEqual(appliedEvents[0].outcome, 'reached', 'Should include outcome');
    });

    test('undo emits undone', async () => {
      const fnToRefactor = createMockFnToRefactor();
      const goal = createMockGoal();
      const request = new RefactoringRequest(fnToRefactor, document, false, goal);

      let answer!: (choice: string | undefined) => void;
      infoAnswer = new Promise((resolve) => (answer = resolve));

      const run = runGoalFix(request);
      await flushPromises();

      pending[0].resolve(responseWith(fixed));
      await run;

      capturedEvents = [];

      answer(UNDO_GOAL_FIX);
      await flushPromises();

      const undoneEvents = capturedEvents.filter((e) => e['event-name'] === 'vscode/ai/fix-task/undone');
      assert.strictEqual(undoneEvents.length, 1, 'Should emit undone once');
    });

    test('refused undo emits nothing', async () => {
      const fnToRefactor = createMockFnToRefactor();
      const goal = createMockGoal();
      const request = new RefactoringRequest(fnToRefactor, document, false, goal);

      let answer!: (choice: string | undefined) => void;
      infoAnswer = new Promise((resolve) => (answer = resolve));

      const run = runGoalFix(request);
      await flushPromises();

      pending[0].resolve(responseWith(fixed));
      await run;

      document.setText('changed content');

      capturedEvents = [];

      answer(UNDO_GOAL_FIX);
      await flushPromises();

      const undoneEvents = capturedEvents.filter((e) => e['event-name'] === 'vscode/ai/fix-task/undone');
      assert.strictEqual(undoneEvents.length, 0, 'Should not emit undone when undo is refused');
      assert.strictEqual(warnings.length, 1, 'Should show warning when undo is refused');
    });

    test('file changed before apply emits failed with reason file-changed', async () => {
      const fnToRefactor = createMockFnToRefactor();
      const goal = createMockGoal();
      const request = new RefactoringRequest(fnToRefactor, document, false, goal);

      const run = runGoalFix(request);
      await flushPromises();

      document.setText('changed content');

      pending[0].resolve(responseWith(fixed));
      await run;

      const failedEvents = capturedEvents.filter((e) => e['event-name'] === 'vscode/ai/fix-task/failed');
      assert.strictEqual(failedEvents.length, 1, 'Should emit failed once');
      assert.strictEqual(failedEvents[0].reason, 'file-changed', 'Should include reason file-changed');
      assert.strictEqual(warnings.length, 1, 'Should show warning when file changed');
    });

    test('fix-task never emits presented, diff-shown, copied or discarded', async () => {
      const fnToRefactor = createMockFnToRefactor();
      const goal = createMockGoal();
      const request = new RefactoringRequest(fnToRefactor, document, false, goal);

      const run = runGoalFix(request);
      await flushPromises();

      pending[0].resolve(responseWith(fixed));
      await run;

      const panelStages = capturedEvents.filter((e) =>
        ['presented', 'diff-shown', 'copied', 'discarded'].some((stage) => e['event-name']?.includes(`/${stage}`))
      );
      assert.strictEqual(panelStages.length, 0, 'fix-task should never emit panel stages');
    });
  });
});
