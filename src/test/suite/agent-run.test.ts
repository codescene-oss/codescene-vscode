import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as configModule from '../../configuration';
import { CsExtensionState } from '../../cs-extension-state';
import * as csExtensionState from '../../cs-extension-state';
import { DevtoolsAPI } from '../../devtools-api';
import { AbortError } from '../../devtools-api/abort-error';
import { FnToRefactor } from '../../devtools-api/refactor-models';
import { FIX_GOAL_SKILL, RENDER_CODE_FIX_SKILL } from '../../refactoring/agent-config';
import { agentBinaryPath, killAllAgentProcesses, spawnAgent, waitForExit } from '../../refactoring/agent-process';
import { AgentRefactoringService } from '../../refactoring/agent-service';
import { resolveAgentToken } from '../../refactoring/agent-token';
import { ScoreGoalTarget } from '../../refactoring/agent-types';
import { runConnectivityTestCommand, testConnectivity } from '../../refactoring/connectivity';
import { FakeAgent } from '../fake-agent';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { TestTextDocument } from '../mocks/test-text-document';
import { Position, Range } from '../mocks/vscode';
import {
  assertLogContains,
  createMockWorkspaceFolder,
  getMockProgress,
  mockWorkspaceFolders,
  resetMockProgress,
  restoreDefaultWorkspaceFolders,
} from '../setup';

const fixturesDir = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'agent-output');
const fixProposed = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'fix-proposed.json'), 'utf-8'));
const fnBody = 'function test(a: number) {\n  if (a > 0) {\n    if (a > 1) {\n      return a;\n    }\n  }\n  return 0;\n}';

function fnToRefactor(body: string = fnBody): FnToRefactor {
  return {
    name: 'test',
    body,
    'file-type': 'typescript',
    range: { 'start-line': 1, 'start-column': 1, 'end-line': 8, 'end-column': 2 },
    'refactoring-targets': [{ category: 'Deep, Nested Complexity', line: 2 }],
    vscodeRange: new Range(new Position(0, 0), new Position(7, 1)) as any,
  };
}

suite('Agent run Test Suite', () => {
  let fakeAgent: FakeAgent;
  let workDir: string;
  let document: TestTextDocument;
  const originalGetAuthToken = configModule.getAuthToken;
  const originalAuthToken = DevtoolsAPI.authToken;
  let authToken: string | undefined;

  suiteSetup(() => {
    fakeAgent = new FakeAgent();
    CsExtensionState.init(createMockExtensionContext(fakeAgent.extensionPath));
  });

  suiteTeardown(() => fakeAgent.dispose());

  setup(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-agent-run-'));
    const file = path.join(workDir, 'test.ts');
    fs.writeFileSync(file, fnBody);
    document = new TestTextDocument(file, fnBody, 'typescript');
    authToken = 'test-token';
    (configModule as any).getAuthToken = () => authToken;
    DevtoolsAPI.authToken = () => Promise.reject(new Error('not signed in'));
    resetMockProgress();
    mockWorkspaceFolders([createMockWorkspaceFolder(workDir)]);
  });

  teardown(async () => {
    killAllAgentProcesses();
    fakeAgent.deactivate();
    restoreDefaultWorkspaceFolders();
    (configModule as any).getAuthToken = originalGetAuthToken;
    DevtoolsAPI.authToken = originalAuthToken;
    DevtoolsAPI.disableAce();
    await fs.promises.rm(workDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  suite('agent binary', () => {
    test('agentBinaryPath resolves the bundled agent', () => {
      fakeAgent.activate();
      assert.strictEqual(path.dirname(agentBinaryPath()), path.join(fakeAgent.extensionPath, 'bin'));
    });

    const missingCases = [
      { name: 'without an extension path', extensionPath: undefined, expected: /Extension path not available/ },
      { name: 'when the binary is missing', extensionPath: os.tmpdir(), expected: /The Refactoring Agent is not available for/ },
    ];
    for (const { name, extensionPath, expected } of missingCases) {
      test(`agentBinaryPath fails ${name}`, () => {
        fakeAgent.activate();
        (csExtensionState as any).getExtensionPath = () => extensionPath;
        assert.throws(() => agentBinaryPath(), expected);
      });
    }

    test('spawnAgent passes the config to the agent', async function () {
      this.timeout(20000);
      fakeAgent.activate({ exitCode: 4 });
      const code = await waitForExit(spawnAgent(['run'], '{"plugins":["p"]}', { cwd: workDir }), { timeoutMs: 15000 });
      assert.deepStrictEqual({ code, config: fakeAgent.invocation()?.config }, { code: 4, config: { plugins: ['p'] } });
    });
  });

  suite('connectivity', () => {
    test('testConnectivity runs the connectivity skill', async function () {
      this.timeout(20000);
      fakeAgent.activate({ stdout: 'ok\n' });
      const result = await testConnectivity({ timeoutMs: 15000 });
      const invocation = fakeAgent.invocation();
      assert.deepStrictEqual(
        { result, skill: invocation?.args[0], token: invocation?.config.codescene_access_token },
        { result: { success: true }, skill: 'skill:check-connectivity', token: 'test-token' }
      );
    });

    const failureCases = [
      { name: 'reports the agent error', behavior: { stderr: 'bad credentials\n', exitCode: 2 }, timeoutMs: 15000, expected: 'bad credentials' },
      { name: 'reports the exit code without stderr', behavior: { exitCode: 3 }, timeoutMs: 15000, expected: 'Process exited with code 3' },
      { name: 'reports a timeout', behavior: { hang: true }, timeoutMs: 500, expected: 'Connectivity test timed out' },
    ];
    for (const { name, behavior, timeoutMs, expected } of failureCases) {
      test(`testConnectivity ${name}`, async function () {
        this.timeout(20000);
        fakeAgent.activate(behavior);
        assert.deepStrictEqual(await testConnectivity({ timeoutMs }), { success: false, error: expected });
      });
    }

    test('testConnectivity reports a cancellation', async function () {
      this.timeout(20000);
      fakeAgent.activate({ hang: true });
      const controller = new AbortController();
      controller.abort();
      assert.deepStrictEqual(await testConnectivity({ signal: controller.signal }), {
        success: false,
        error: 'Connectivity test cancelled',
      });
    });
  });

  suite('connectivity command', () => {
    const window = vscode.window as any;
    const originals = { info: window.showInformationMessage, error: window.showErrorMessage };
    let messages: string[];

    setup(() => {
      messages = [];
      window.showInformationMessage = async (message: string) => messages.push(`info: ${message}`);
      window.showErrorMessage = async (message: string) => messages.push(`error: ${message}`);
    });

    teardown(() => {
      window.showInformationMessage = originals.info;
      window.showErrorMessage = originals.error;
    });

    const cases = [
      {
        name: 'asks to enable the agent when it is disabled',
        enabled: false,
        behavior: {},
        expected: ['info: Enable "Enable Auto Refactor" and sign in to CodeScene to test provider connectivity.'],
      },
      { name: 'reports success', enabled: true, behavior: {}, expected: ['info: Provider connectivity test successful.'] },
      {
        name: 'reports a failure',
        enabled: true,
        behavior: { stderr: 'no model', exitCode: 1 },
        expected: ['error: Provider connectivity test failed: no model'],
      },
    ];
    for (const { name, enabled, behavior, expected } of cases) {
      test(`runConnectivityTestCommand ${name}`, async function () {
        this.timeout(20000);
        fakeAgent.activate(behavior);
        if (enabled) DevtoolsAPI.enableAce();
        await runConnectivityTestCommand();
        assert.deepStrictEqual(messages, expected);
      });
    }

    test('runConnectivityTestCommand stays quiet when cancelled', async function () {
      this.timeout(20000);
      fakeAgent.activate({ hang: true });
      DevtoolsAPI.enableAce();
      const run = runConnectivityTestCommand();
      getMockProgress()[0].cancel();
      await run;
      assert.deepStrictEqual(messages, []);
    });
  });

  suite('refactoring', () => {
    test('runRefactoring maps the agent output and reports progress', async function () {
      this.timeout(20000);
      fakeAgent.activate({
        stdout: 'Reading file\nRefactoring\n',
        stderr: 'warning\n',
        outputFile: RENDER_CODE_FIX_SKILL.outputFile,
        output: fixProposed,
      });
      const progress: string[] = [];
      const response = await AgentRefactoringService.runRefactoring(document, fnToRefactor(), undefined, undefined, (m) =>
        progress.push(m)
      );
      const { file, line, smell } = fakeAgent.invocation()?.input as any;
      assert.deepStrictEqual(
        { code: response.code, traceId: response['trace-id'], progress, input: { file, line, smell } },
        {
          code: 'function test(a: number) {\n  return processValue(a);\n  return 0;\n}',
          traceId: 'refactor-test-123',
          progress: ['Refactoring'],
          input: { file: document.fileName, line: 2, smell: 'Deep, Nested Complexity' },
        }
      );
      assertLogContains('debug', '[cs-agent:err] warning');
    });

    const failureCases = [
      {
        name: 'fails when the agent exits with an error',
        behavior: { stderr: 'quota exceeded', exitCode: 5 },
        expected: /Agent exited with code 5: quota exceeded/,
      },
      {
        name: 'fails when the agent writes no output',
        behavior: { stderr: 'no output written' },
        expected: /Agent did not produce output file: no output written/,
      },
    ];
    for (const { name, behavior, expected } of failureCases) {
      test(`runRefactoring ${name}`, async function () {
        this.timeout(20000);
        fakeAgent.activate(behavior);
        await assert.rejects(AgentRefactoringService.runRefactoring(document, fnToRefactor()), expected);
      });
    }

    test('runRefactoring requires a sign-in', async () => {
      fakeAgent.activate();
      authToken = undefined;
      await assert.rejects(AgentRefactoringService.runRefactoring(document, fnToRefactor()), /requires you to be signed in/);
      assert.strictEqual(fakeAgent.invocation(), undefined);
    });

    test('runRefactoring does not start the agent once aborted', async () => {
      fakeAgent.activate();
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(AgentRefactoringService.runRefactoring(document, fnToRefactor(), controller.signal), AbortError);
      assert.strictEqual(fakeAgent.invocation(), undefined);
    });

    test('runRefactoring keeps the agent files when asked to', async function () {
      this.timeout(20000);
      fakeAgent.activate({ outputFile: RENDER_CODE_FIX_SKILL.outputFile, output: fixProposed });
      await AgentRefactoringService.runRefactoring(document, fnToRefactor(), undefined, true);
      const ioDir = fakeAgent.invocation()?.config.io_json_dir;
      assert.ok(fs.existsSync(path.join(ioDir, RENDER_CODE_FIX_SKILL.inputFile)));
      fs.rmSync(ioDir, { recursive: true, force: true });
    });

    test('runFixGoal scores the proposal of the fix-goal skill', async function () {
      this.timeout(20000);
      const goal: ScoreGoalTarget = {
        goalId: 2,
        metricId: 'average-code-health',
        operator: 'greater-than-or-equal',
        target: 8,
        baseline: 6.2,
        repoRoot: workDir,
        path: 'test.ts',
      };
      fakeAgent.activate({
        outputFile: FIX_GOAL_SKILL.outputFile,
        output: {
          schema_version: '1.0',
          task_id: 't',
          fix_result: 'target_reached',
          confidence: 'high',
          whole_file_content: 'function test() {}\n',
          generated_at: '2026-11-16T00:00:00Z',
        },
      });
      const scored: string[] = [];
      const response = await AgentRefactoringService.runFixGoal(document, fnToRefactor(), goal, async (content) => {
        scored.push(content);
        return 8.5;
      });
      assert.deepStrictEqual(
        { outcome: response['goal-outcome'], scored, skill: fakeAgent.invocation()?.args[0] },
        { outcome: 'reached', scored: ['function test() {}\n'], skill: 'skill:fix-goal' }
      );
    });
  });

  suite('agent token', () => {
    const cases = [
      { name: 'prefers the configured token', setting: 'setting-token', ide: Promise.resolve({ 'access-token': 'ide' }), expected: 'setting-token' },
      { name: 'falls back to the IDE sign-in token', setting: undefined, ide: Promise.resolve({ 'access-token': 'ide' }), expected: 'ide' },
      { name: 'has no token when not signed in', setting: undefined, ide: Promise.reject(new Error('not signed in')), expected: undefined },
    ];
    for (const { name, setting, ide, expected } of cases) {
      test(`resolveAgentToken ${name}`, async () => {
        ide.catch(() => undefined);
        authToken = setting;
        DevtoolsAPI.authToken = () => ide as any;
        assert.strictEqual(await resolveAgentToken(), expected);
      });
    }

    test('resolveAgentToken logs why there is no IDE token', async () => {
      authToken = undefined;
      DevtoolsAPI.authToken = () => Promise.reject(new Error('not signed in'));
      await resolveAgentToken();
      assertLogContains('debug', 'No IDE sign-in token available: not signed in');
    });
  });
});
