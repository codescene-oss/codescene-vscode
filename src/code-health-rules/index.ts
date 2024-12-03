import { commands, ExtensionContext, window } from 'vscode';
import { checkCodeHealthRules } from './check-rules';
import { createRulesTemplate } from './rules-template';
import Telemetry from '../telemetry';

export function register(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('codescene.createRulesTemplate', () => {
      Telemetry.logUsage('createRulesTemplate');
      createRulesTemplate().catch((error: Error) => {
        void window.showErrorMessage(error.message);
      });
    }),
    commands.registerCommand('codescene.checkRules', () => {
      Telemetry.logUsage('checkRules');
      void checkCodeHealthRules();
    })
  );
}
