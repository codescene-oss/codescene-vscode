import { commands, ExtensionContext, window } from 'vscode';
import Telemetry from '../telemetry';
import { checkCodeHealthRules } from './check-rules';
import { createRulesTemplate } from './rules-template';

export function register(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('codescene.createRulesTemplate', () => {
      Telemetry.logUsage('code-health-rules/create-template');
      createRulesTemplate().catch((error: Error) => {
        void window.showErrorMessage(error.message);
      });
    }),
    commands.registerCommand('codescene.checkRules', () => {
      Telemetry.logUsage('code-health-rules/check');
      void checkCodeHealthRules();
    })
  );
}
