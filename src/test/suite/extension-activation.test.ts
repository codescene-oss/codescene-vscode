import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CsExtensionState } from '../../cs-extension-state';
import { DevtoolsAPI } from '../../devtools-api';
import { activate, deactivate } from '../../extension-impl';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import Telemetry from '../../telemetry';
import { mockConfiguration, restoreDefaultConfiguration } from '../setup';

function projectRoot(): string {
  return path.join(__dirname, '../../..');
}

function createActivationContext(extensionPath?: string) {
  const context = createMockExtensionContext(extensionPath ?? projectRoot());
  if (extensionPath) {
    (context as any).extensionPath = extensionPath;
  }
  (context as any).extension = {
    id: 'CodeScene.codescene-vscode',
    packageJSON: { version: '0.28.2' },
  };
  (context as any).workspaceState = {
    get: () => undefined,
    update: async () => {},
  };
  (context as any).secrets = {
    get: async () => undefined,
    store: async () => {},
    delete: async () => {},
  };
  return context;
}

suite('Extension Activation Test Suite', function () {
  this.timeout(60000);

  teardown(async () => {
    try {
      await deactivate();
    } catch {
      DevtoolsAPI.dispose();
    }
  });

  test('activate reports an error when the bundled distribution is missing', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codescene-activate-missing-'));
    try {
      await activate(createActivationContext(emptyDir));
      assert.strictEqual(CsExtensionState.stateProperties.features.analysis.state, 'error');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('activate shows UI then finishes background startup', async () => {
    await activate(createActivationContext());
    const analysis = CsExtensionState.stateProperties.features.analysis;
    assert.strictEqual(analysis.state, 'enabled', analysis.error?.message);
  });

  test('activate keeps the error state when the IDE server version does not match', async () => {
    const previous = process.env.CS_IDE_REQUIRED_VERSION;
    process.env.CS_IDE_REQUIRED_VERSION = 'not-the-required-sha';
    try {
      await activate(createActivationContext());
      assert.strictEqual(CsExtensionState.stateProperties.features.analysis.state, 'error');
    } finally {
      if (previous === undefined) {
        delete process.env.CS_IDE_REQUIRED_VERSION;
      } else {
        process.env.CS_IDE_REQUIRED_VERSION = previous;
      }
    }
  });

  suite('Session lifecycle integration', function () {
    let capturedEvents: any[] = [];
    let originalPostTelemetry: any;
    let postResolvers: Array<() => void> = [];

    setup(() => {
      capturedEvents = [];
      postResolvers = [];
      originalPostTelemetry = DevtoolsAPI.postTelemetry;
      DevtoolsAPI.postTelemetry = async (event: any) => {
        if (postResolvers.length > 0) {
          const resolver = postResolvers.shift();
          if (resolver) {
            await new Promise<void>((resolve) => {
              postResolvers.push(resolve);
            });
          }
        }
        capturedEvents.push(event);
        return { status: 200 };
      };
    });

    teardown(async () => {
      DevtoolsAPI.postTelemetry = originalPostTelemetry;
      postResolvers.forEach((r) => r());
      postResolvers = [];
      restoreDefaultConfiguration();
      try {
        await deactivate();
      } catch {
        DevtoolsAPI.dispose();
      }
    });

    test('deactivation awaits the session-ended hand-over', async function () {
      this.timeout(10000);
      mockConfiguration('codescene', { enableTelemetry: true });

      postResolvers.push(() => {});

      await activate(createActivationContext());

      Telemetry.logUsage('test-event');
      await new Promise((resolve) => setTimeout(resolve, 10));

      const deactivatePromise = deactivate();
      let deactivated = false;
      void deactivatePromise.then(() => {
        deactivated = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.strictEqual(deactivated, false, 'Deactivation should not complete yet');

      postResolvers[0]();
      await deactivatePromise;

      assert.strictEqual(deactivated, true, 'Deactivation should complete after posts settle');
    });

    test('deactivation waits at most the bound', async function () {
      this.timeout(10000);
      mockConfiguration('codescene', { enableTelemetry: true });

      postResolvers.push(() => {});

      await activate(createActivationContext());

      Telemetry.logUsage('test-event');
      await new Promise((resolve) => setTimeout(resolve, 10));

      const originalEndSession = Telemetry.endSession;
      Telemetry.endSession = async () => {
        return originalEndSession.call(Telemetry, 50);
      };

      const start = Date.now();
      await deactivate();
      const elapsed = Date.now() - start;

      assert.ok(elapsed >= 45 && elapsed < 200, `Should wait approximately 50ms, waited ${elapsed}ms`);
    });

    test('deactivation does not wait when the telemetry level suppresses session-ended', async function () {
      this.timeout(10000);
      mockConfiguration('codescene', { enableTelemetry: false });

      await activate(createActivationContext());

      const start = Date.now();
      await deactivate();
      const elapsed = Date.now() - start;

      assert.ok(elapsed < 100, `Should not wait when telemetry is off, took ${elapsed}ms`);
    });

    test('endSession without telemetry returns at once', async function () {
      this.timeout(10000);
      mockConfiguration('codescene', { enableTelemetry: false });

      const start = Date.now();
      await Telemetry.endSession(500);
      const elapsed = Date.now() - start;

      assert.ok(elapsed < 100, `Should return at once without telemetry, took ${elapsed}ms`);
    });

    test('deactivation releases held events at once', async function () {
      this.timeout(10000);
      mockConfiguration('codescene', { enableTelemetry: true });

      await activate(createActivationContext());

      await new Promise((resolve) => setTimeout(resolve, 500));

      Telemetry.resetForTests();
      (Telemetry as any)._instance = new Telemetry({ id: 'test', packageJSON: { version: '1.0.0' } } as any);

      Telemetry.routing.hold();
      Telemetry.logUsage('held-event');
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.strictEqual(
        capturedEvents.filter((e) => e['event-name']?.includes('/held-event')).length,
        0,
        'Event should be held'
      );

      await deactivate();
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.ok(
        capturedEvents.some((e) => e['event-name']?.includes('/held-event')),
        'Held event should be released'
      );
      assert.ok(
        capturedEvents.some((e) => e['event-name']?.includes('/session/ended')),
        'session/ended should be captured'
      );
    });

    test('activation logs session-started', async function () {
      this.timeout(10000);
      mockConfiguration('codescene', { enableTelemetry: true, signInEnabled: false });

      capturedEvents = [];

      await activate(createActivationContext());

      Telemetry.routing.close?.();

      await new Promise((resolve) => setTimeout(resolve, 500));

      const sessionStarted = capturedEvents.filter((e) => e['event-name']?.includes('/session/started'));
      assert.strictEqual(sessionStarted.length, 1, `session/started should be logged once`);
    });

    test('turning telemetry off and on again does not emit a second session-started', async function () {
      this.timeout(10000);
      mockConfiguration('codescene', { enableTelemetry: true, signInEnabled: false });

      capturedEvents = [];
      await activate(createActivationContext());

      Telemetry.routing.close?.();

      await new Promise((resolve) => setTimeout(resolve, 500));

      const firstCount = capturedEvents.filter((e) => e['event-name']?.includes('/session/started')).length;
      assert.strictEqual(firstCount, 1, 'session/started should be logged once initially');

      (Telemetry as any)._instance?.dispose();
      (Telemetry as any)._instance = undefined;

      const extension = { id: 'codescene.codescene-vscode', packageJSON: { version: '1.0.0' } } as any;
      (Telemetry as any)._instance = new Telemetry(extension);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const secondCount = capturedEvents.filter((e) => e['event-name']?.includes('/session/started')).length;
      assert.strictEqual(secondCount, 1, 'session/started should still be logged only once after re-enabling');
    });
  });
});
