import * as assert from 'assert';
import vscode from 'vscode';
import Telemetry from '../../telemetry';

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
