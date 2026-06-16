import vscode from 'vscode';
import { logOutputChannel } from './log';
import { assertError } from './utils';

export const migrationKey = 'codescene.lastSeenVersion';

function isUnderTestsOrCI(): boolean {
  const appName = vscode.env.appName ?? '';
  const argv = process.argv.join(' ');
  return (
    process.env.VSCODE_TEST === 'true' ||
    process.env.CI === 'true' ||
    /- Test/i.test(appName) ||
    argv.includes('--extensionTestsPath') ||
    !!process.env.CODE_TESTS_PATH
  );
}

async function shouldReloadOnUpdate(): Promise<boolean> {
  const cfg = vscode.workspace.getConfiguration('codescene');
  const enabled = cfg.get<boolean>('reloadOnUpdate', true);
  return enabled;
}

export async function reloadWindowForUpdate(context: vscode.ExtensionContext) {
  const current = context.extension.packageJSON.version ?? '0.0.0';
  const prev = context.globalState.get<string>(migrationKey);
  logOutputChannel.info(`${current} extension version, previous version was ${prev}`);

  await context.globalState.update(migrationKey, current);

  if (isUnderTestsOrCI()) {
    logOutputChannel.info(`[TEST/CI] Version changed ${prev} -> ${current}, reload skipped.`);
    return;
  }

  if (!(await shouldReloadOnUpdate())) {
    logOutputChannel.info(`[codescene] reloadOnUpdate disabled; skipping reload ${prev} -> ${current}.`);
    return;
  }

  const versionChanged = current !== prev;
  if (!versionChanged) {
    logOutputChannel.info('Version unchanged, no reload needed.');
    return;
  }

  try {
    logOutputChannel.info(`[codescene] Reloading window due to update: ${prev} -> ${current}`);
    void vscode.commands.executeCommand('workbench.action.reloadWindow');
  } catch (e) {
    logOutputChannel.error('Error triggering reload after update:', assertError(e));
  }
}

export function guardWindowLifecycleDuringTests() {
  if (!isUnderTestsOrCI()) return;
  const original = vscode.commands.executeCommand;
  // @ts-expect-error test-only monkey patch
  vscode.commands.executeCommand = (command: string, ...args: any[]) => {
    const windowLifecycleCommands = [
      'workbench.action.reloadWindow',
      'workbench.action.quit',
      'workbench.action.closeWindow',
    ];
    if (windowLifecycleCommands.includes(command)) {
      console.log(`[TEST] Ignored command: ${command}`);
      return Promise.resolve(undefined);
    }
    return original(command, ...args);
  };
}
