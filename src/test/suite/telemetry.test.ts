import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import vscode from 'vscode';
import Telemetry from '../../telemetry';
import { DevtoolsAPI } from '../../devtools-api';
import { CsExtensionState } from '../../cs-extension-state';
import { mockWorkspaceFolders, restoreDefaultWorkspaceFolders, createMockWorkspaceFolder, setMockExtensionForTelemetry, resetMockExtensionForTelemetry, mockConfiguration, restoreDefaultConfiguration } from '../setup';
import { createHarness, type Harness, type HarnessOptions } from '../fakes/auth-service-harness';
import { flushPromises } from '../fakes/fake-auth-transport';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';

suite('Telemetry Test Suite', () => {
  test('creates the logger with unhandled errors ignored', () => {
    let capturedOptions: vscode.TelemetryLoggerOptions | undefined;
    const originalCreateTelemetryLogger = (vscode.env as any).createTelemetryLogger;

    (vscode.env as any).createTelemetryLogger = (
      sender: vscode.TelemetrySender,
      options?: vscode.TelemetryLoggerOptions
    ) => {
      void sender;
      capturedOptions = options;
      return { logUsage: () => {}, logError: () => {}, dispose: () => {} };
    };

    try {
      const extension = { id: 'test', packageJSON: { version: '1.0.0' } } as any;
      new Telemetry(extension);

      assert.ok(capturedOptions, 'Options should be passed to createTelemetryLogger');
      assert.strictEqual(capturedOptions?.ignoreUnhandledErrors, true);
    } finally {
      (vscode.env as any).createTelemetryLogger = originalCreateTelemetryLogger;
    }
  });

  test('sendErrorData sends nothing', () => {
    const events: Array<{ name: string; data?: Record<string, any> }> = [];
    let capturedSender: vscode.TelemetrySender | undefined;
    const originalCreateTelemetryLogger = (vscode.env as any).createTelemetryLogger;

    (vscode.env as any).createTelemetryLogger = (sender: vscode.TelemetrySender) => {
      capturedSender = sender;
      return {
        logUsage: (name: string, data?: Record<string, any>) => {
          events.push({ name, data });
        },
        logError: () => {},
        dispose: () => {},
      };
    };

    try {
      const extension = { id: 'test', packageJSON: { version: '1.0.0' } } as any;
      new Telemetry(extension);

      assert.ok(capturedSender, 'Sender should be captured');

      const error = new Error('Test error');
      capturedSender!.sendErrorData(error, { context: 'test' });

      assert.strictEqual(events.length, 0, 'sendErrorData should not send any events');
    } finally {
      (vscode.env as any).createTelemetryLogger = originalCreateTelemetryLogger;
    }
  });
});

suite('Telemetry envelope', () => {
  let capturedEvents: any[] = [];
  let originalIdeServer: any;
  let originalInstance: any;
  let originalStateProperties: PropertyDescriptor | undefined;
  let extension: any;

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
    (Telemetry as any)._instance = new Telemetry(extension);
  });

  teardown(() => {
    Telemetry.resetForTests();
    (DevtoolsAPI as any).ideServer = originalIdeServer;
    (Telemetry as any)._instance = originalInstance;
    (Telemetry as any).sessionId = undefined;
    if (originalStateProperties) {
      Object.defineProperty(CsExtensionState, 'stateProperties', originalStateProperties);
    }
    resetMockExtensionForTelemetry();
    restoreDefaultWorkspaceFolders();
    restoreDefaultConfiguration();
  });

  test('carries the session id on every event', async () => {
    Telemetry.logUsage('test-event');
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.strictEqual(capturedEvents.length, 1, 'postTelemetry should be called once');
    const event = capturedEvents[0];
    assert.strictEqual(event['session-id'], 'test-session-id');
  });

  test('keeps the session id when telemetry is disabled and enabled again', async () => {
    Telemetry.logUsage('event-1');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const firstSessionId = capturedEvents[0]['session-id'];

    (Telemetry as any)._instance.dispose();
    (Telemetry as any)._instance = undefined;

    (Telemetry as any)._instance = new Telemetry(extension);
    Telemetry.logUsage('event-2');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const secondSessionId = capturedEvents[1]['session-id'];

    assert.strictEqual(firstSessionId, secondSessionId, 'Session ID should remain the same');
  });

  test('uses the workspace folders when no repository paths are given', async () => {
    mockWorkspaceFolders([
      createMockWorkspaceFolder('/workspace/project1'),
      createMockWorkspaceFolder('/workspace/project2'),
    ]);

    Telemetry.logUsage('test-event');
    await new Promise((resolve) => setTimeout(resolve, 100));

    const event = capturedEvents[0];
    assert.deepStrictEqual(event['repository-paths'], ['/workspace/project1', '/workspace/project2']);
  });

  test('omits repository paths without workspace folders', async () => {
    mockWorkspaceFolders(undefined);

    Telemetry.logUsage('test-event');
    await new Promise((resolve) => setTimeout(resolve, 100));

    const event = capturedEvents[0];
    assert.strictEqual(event['repository-paths'], undefined);
  });

  test('an AI event\'s repository root under the home directory reaches cs-ide unredacted', async () => {
    const repoPath = path.join(os.homedir(), 'repo');
    Telemetry.logUsage('ai/test', {
      'repository-paths': new vscode.TelemetryTrustedValue([repoPath]),
      'other-path': path.join(os.homedir(), 'other'),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const event = capturedEvents[0];
    assert.deepStrictEqual(event['repository-paths'], [repoPath], 'Trusted repository path should be unredacted');
    assert.strictEqual(event['other-path'], '<REDACTED: user-file-path>', 'Non-trusted path should be redacted');
  });

  test('an empty trusted repository list omits the field', async () => {
    Telemetry.logUsage('test-event', {
      'repository-paths': new vscode.TelemetryTrustedValue([]),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const event = capturedEvents[0];
    assert.strictEqual(event['repository-paths'], undefined, 'Empty repository list should be omitted');
  });

  test('sends nothing when enableTelemetry is false', async () => {
    mockConfiguration('codescene', { enableTelemetry: false });

    Telemetry.logUsage('test-event');
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.strictEqual(capturedEvents.length, 0, 'postTelemetry should not be called when telemetry is disabled');
  });

  test('a held event keeps the event-time it was logged with', async () => {
    const generation = Telemetry.routing.hold();

    const beforeTime = new Date();
    Telemetry.logUsage('test-event');
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(capturedEvents.length, 0, 'Event should be held');

    Telemetry.routing.ready(generation);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(capturedEvents.length, 1, 'Event should be released');
    const event = capturedEvents[0];
    const eventTime = new Date(event['event-time']);

    const timeDiff = eventTime.getTime() - beforeTime.getTime();
    assert.ok(timeDiff >= 0 && timeDiff < 100, 'Event time should be close to when it was logged, not when released');
  });
});

suite('Telemetry routing with auth', () => {
  const boundMs = 300;
  let capturedEvents: any[] = [];
  let originalIdeServer: any;
  let originalInstance: any;
  let originalStateProperties: PropertyDescriptor | undefined;
  let harness: Harness | undefined;

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function startHarness(options: HarnessOptions = {}): Harness {
    harness = createHarness({ ...options, routing: Telemetry.routing });
    return harness;
  }

  function sentNames(): string[] {
    return capturedEvents.map((e) => e['event-name']);
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    const extension = { id: 'codescene.codescene-vscode', packageJSON: { version: '1.0.0' } };
    setMockExtensionForTelemetry(extension);
    Telemetry.resetForTests(boundMs);
    Telemetry.routing.hold();
    (Telemetry as any)._instance = new Telemetry(extension as any);
  });

  teardown(() => {
    harness?.service.dispose();
    harness = undefined;
    Telemetry.resetForTests();
    (DevtoolsAPI as any).ideServer = originalIdeServer;
    (Telemetry as any)._instance = originalInstance;
    (Telemetry as any).sessionId = undefined;
    if (originalStateProperties) {
      Object.defineProperty(CsExtensionState, 'stateProperties', originalStateProperties);
    }
    resetMockExtensionForTelemetry();
    restoreDefaultConfiguration();
  });

  test('routing stays held until a late auth-configure settles', async () => {
    const configure = deferred<unknown>();
    const h = startHarness();
    h.transport.respond('cs-ide/auth-configure', () => configure.promise);

    const loggedFrom = Date.now();
    Telemetry.logUsage('session/started');
    const loggedTo = Date.now();
    const started = h.service.start();
    await wait(20);

    assert.deepStrictEqual(sentNames(), []);
    assert.ok(h.transport.methods().includes('cs-ide/auth-configure'));

    configure.resolve(authStatusFixture('signed-out'));
    await started;
    await flushPromises();

    assert.deepStrictEqual(sentNames(), ['vscode/session/started']);
    const eventTime = new Date(capturedEvents[0]['event-time']).getTime();
    assert.ok(eventTime >= loggedFrom && eventTime <= loggedTo, 'the event keeps the time it was logged at');
  });

  test('routing is ready once the start is handled when sign-in is disabled', async () => {
    const h = startHarness({ signInEnabled: false });

    Telemetry.logUsage('session/started');
    await h.service.start();
    await flushPromises();

    assert.ok(!h.transport.methods().includes('cs-ide/auth-configure'));
    assert.deepStrictEqual(sentNames(), ['vscode/session/started']);
  });

  test('routing is ready when auth-configure fails', async () => {
    const configure = deferred<unknown>();
    const h = startHarness();
    h.transport.respond('cs-ide/auth-configure', () => configure.promise);

    Telemetry.logUsage('session/started');
    const started = h.service.start();
    await flushPromises();
    assert.deepStrictEqual(sentNames(), []);

    configure.reject(new Error('auth-configure failed'));
    await started;
    await flushPromises();

    assert.deepStrictEqual(sentNames(), ['vscode/session/started']);
  });

  test('the bound releases events when auth-configure never settles', async () => {
    const h = startHarness();
    h.transport.respond('cs-ide/auth-configure', () => new Promise(() => {}));

    Telemetry.logUsage('session/started');
    void h.service.start();
    await flushPromises();
    assert.deepStrictEqual(sentNames(), []);

    await wait(boundMs + 100);

    assert.deepStrictEqual(sentNames(), ['vscode/session/started']);
  });

  const restarts: Array<{ name: string; restart: (h: Harness) => void }> = [
    { name: 'restart', restart: (h) => void h.transport.restart() },
    {
      name: 'crash then a start',
      restart: (h) => {
        h.transport.crash();
        h.transport.emitRestart();
      },
    },
  ];

  restarts.forEach(({ name, restart }) => {
    test(`a cs-ide ${name} holds events again until the new configure settles`, async () => {
      const h = startHarness();
      await h.service.start();
      await flushPromises();

      const configure = deferred<unknown>();
      h.transport.respond('cs-ide/auth-configure', () => configure.promise);
      restart(h);
      Telemetry.logUsage('after-restart');
      await flushPromises();

      assert.deepStrictEqual(sentNames(), []);

      configure.resolve(authStatusFixture('signed-out'));
      await flushPromises();
      await flushPromises();

      assert.deepStrictEqual(sentNames(), ['vscode/after-restart']);
    });
  });

  test('a settings change does not hold events', async () => {
    const h = startHarness();
    await h.service.start();
    await flushPromises();

    const configure = deferred<unknown>();
    h.transport.respond('cs-ide/auth-configure', () => configure.promise);
    h.settings.update({ serverUrl: 'https://cs.example' });
    await flushPromises();
    Telemetry.logUsage('after-settings-change');
    await flushPromises();

    assert.deepStrictEqual(sentNames(), ['vscode/after-settings-change']);
    configure.resolve(authStatusFixture('signed-out'));
  });
});

suite('Session lifecycle', () => {
  let capturedEvents: any[] = [];
  let originalIdeServer: any;
  let originalInstance: any;
  let originalStateProperties: PropertyDescriptor | undefined;
  let extension: any;
  let resolvers: Array<() => void> = [];

  setup(() => {
    mockConfiguration('codescene', { enableTelemetry: true });
    capturedEvents = [];
    resolvers = [];

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
        if (resolvers.length > 0) {
          await new Promise<void>((resolve) => {
            resolvers.push(resolve);
          });
        }
        capturedEvents.push(event);
        return { status: 200 };
      },
    };
    originalInstance = (Telemetry as any)._instance;
    (Telemetry as any).sessionId = 'test-session-id';
    extension = { id: 'codescene.codescene-vscode', packageJSON: { version: '1.0.0' } };
    setMockExtensionForTelemetry(extension);
    Telemetry.resetForTests();
    (Telemetry as any)._instance = new Telemetry(extension);
  });

  teardown(() => {
    Telemetry.resetForTests();
    (DevtoolsAPI as any).ideServer = originalIdeServer;
    (Telemetry as any)._instance = originalInstance;
    (Telemetry as any).sessionId = undefined;
    if (originalStateProperties) {
      Object.defineProperty(CsExtensionState, 'stateProperties', originalStateProperties);
    }
    resetMockExtensionForTelemetry();
    restoreDefaultWorkspaceFolders();
    restoreDefaultConfiguration();
    resolvers.forEach((r) => r());
    resolvers = [];
  });

  test('endSession logs session/ended and waits for in-flight events', async () => {
    let eventResolver: () => void;
    const eventPromise = new Promise<void>((resolve) => {
      eventResolver = resolve;
    });

    (DevtoolsAPI as any).ideServer = {
      telemetry: async (event: any) => {
        await eventPromise;
        capturedEvents.push(event);
        return { status: 200 };
      },
    };

    Telemetry.logUsage('test-event');

    const endPromise = Telemetry.endSession(500);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(capturedEvents.length, 0, 'Events should be in flight');

    eventResolver!();
    await endPromise;

    assert.strictEqual(capturedEvents.length, 2, 'Both events should be captured');
    assert.strictEqual(capturedEvents[0]['event-name'], 'vscode/test-event');
    assert.strictEqual(capturedEvents[1]['event-name'], 'vscode/session/ended');
  });

  test('endSession times out after the bound when events never settle', async () => {
    (DevtoolsAPI as any).ideServer = {
      telemetry: async (event: any) => {
        await new Promise<void>(() => {});
        capturedEvents.push(event);
        return { status: 200 };
      },
    };

    Telemetry.logUsage('test-event');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const start = Date.now();
    await Telemetry.endSession(50);
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= 45 && elapsed < 150, `Should wait approximately 50ms, waited ${elapsed}ms`);
  });

  test('endSession without an instance closes the gate and returns at once', async () => {
    (Telemetry as any)._instance = undefined;

    const start = Date.now();
    await Telemetry.endSession(500);
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 50, `Should return at once, took ${elapsed}ms`);
  });

  test('endSession does not wait when telemetry is off and nothing is in flight', async () => {
    mockConfiguration('codescene', { enableTelemetry: false });

    const start = Date.now();
    await Telemetry.endSession(500);
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 50, `Should return at once when telemetry is off, took ${elapsed}ms`);
    assert.strictEqual(capturedEvents.length, 0, 'No events should be logged');
  });

  test('endSession releases held events at once', async () => {
    Telemetry.routing.hold();

    Telemetry.logUsage('held-event');
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(capturedEvents.length, 0, 'Event should be held');

    await Telemetry.endSession(50);

    assert.ok(capturedEvents.length > 0, 'Events should be released');
    assert.strictEqual(capturedEvents[0]['event-name'], 'vscode/held-event');
    const endedEvent = capturedEvents.find((e) => e['event-name'] === 'vscode/session/ended');
    assert.ok(endedEvent, 'session/ended should be captured');
  });
});
