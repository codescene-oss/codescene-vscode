import * as assert from 'assert';
import * as vscode from 'vscode';
import { revealOnAuthRequest } from '../../auth/auth-feature';

const FOCUS_COMMAND = 'codescene.homeView.focus';

suite('Auth feature reveal', () => {
  const executed: string[] = [];
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  let requests: vscode.EventEmitter<void>;

  setup(() => {
    requests = new vscode.EventEmitter<void>();
    executed.length = 0;
    originalExecuteCommand = vscode.commands.executeCommand;
    vscode.commands.executeCommand = ((command: string) => {
      executed.push(command);
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;
  });

  teardown(() => {
    vscode.commands.executeCommand = originalExecuteCommand;
    requests.dispose();
  });

  const focuses = () => executed.filter((command) => command === FOCUS_COMMAND).length;

  test('focuses the sidebar on every auth request', () => {
    const subscription = revealOnAuthRequest({ onDidRequestAuth: requests.event });
    requests.fire();
    requests.fire();
    subscription.dispose();
    assert.strictEqual(focuses(), 2);
  });

  test('stops focusing once disposed', () => {
    revealOnAuthRequest({ onDidRequestAuth: requests.event }).dispose();
    requests.fire();
    assert.strictEqual(focuses(), 0);
  });
});
