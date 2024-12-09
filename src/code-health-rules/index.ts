import { commands, ExtensionContext, window } from 'vscode';
import { checkCodeHealthRules } from './check-rules';
import { createRulesTemplate } from './rules-template';
import Telemetry from '../telemetry';
import { DevtoolsAPI } from '../devtools-interop/api';

export function register(context: ExtensionContext, devtoolsApi: DevtoolsAPI) {
  context.subscriptions.push(
    commands.registerCommand('codescene.createRulesTemplate', () => {
      Telemetry.logUsage('createRulesTemplate');
      createRulesTemplate(devtoolsApi).catch((error: Error) => {
        void window.showErrorMessage(error.message);
      });
    }),
    commands.registerCommand('codescene.checkRules', () => {
      Telemetry.logUsage('checkRules');
      void checkCodeHealthRules(devtoolsApi);
    })
  );
}
