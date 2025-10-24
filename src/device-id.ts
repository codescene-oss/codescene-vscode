import vscode, { ExtensionContext, commands } from 'vscode';
import { DevtoolsAPI } from './devtools-api';
import { logOutputChannel } from './log';
import { getConfiguration } from './configuration';

export function registerCopyDeviceIdCommand(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('codescene.copyDeviceId', async () => {
      try {
        if (getConfiguration('enableTelemetry')) {
          const deviceId = await DevtoolsAPI.getDeviceId();
          await vscode.env.clipboard.writeText(deviceId);
          void vscode.window.showInformationMessage('Copied device ID to clipboard');
        } else {
          void vscode.window.showWarningMessage('Could not get device ID: User has disabled telemetry.');
        }
      } catch (e) {
        void vscode.window.showWarningMessage('Unable to copy device ID to clipboard');
        logOutputChannel.warn(`Unable to copy device ID to clipboard: ${e}}`);
      }
    })
  );
}
