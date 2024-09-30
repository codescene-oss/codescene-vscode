import { window, ExtensionContext } from 'vscode';
import { registerCommandWithTelemetry } from '../utils';
import { checkCodeHealthRules } from './check-rules';
import { createRulesTemplate } from './rules-template';

export function register(context: ExtensionContext) {
  const createRulesTemplateCmd = registerCommandWithTelemetry({
    commandId: 'codescene.createRulesTemplate',
    handler: () => {
      createRulesTemplate().catch((error: Error) => {
        void window.showErrorMessage(error.message);
      });
    },
  });
  context.subscriptions.push(createRulesTemplateCmd);

  const createCheckRules = registerCommandWithTelemetry({
    commandId: 'codescene.checkRules',
    handler: () => {
      void checkCodeHealthRules();
    },
  });
  context.subscriptions.push(createCheckRules);
}
