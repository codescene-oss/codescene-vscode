import { env, ExtensionContext, Uri, window } from 'vscode';
import Telemetry from './telemetry';
import { registerCommandWithTelemetry } from './utils';

const acceptedTermsAndPoliciesKey = 'termsAndPoliciesAccepted';
export function registerTermsAndPoliciesCmds(context: ExtensionContext) {
  context.globalState.setKeysForSync([acceptedTermsAndPoliciesKey]);
  context.subscriptions.push(
    registerCommandWithTelemetry({
      commandId: 'codescene.revokeTerms',
      handler: async () => {
        await context.globalState.update(acceptedTermsAndPoliciesKey, undefined);
        void window.showInformationMessage('Terms and Privacy Policy agreement has now been revoked');
      },
    })
  );
}

export async function acceptTermsAndPolicies(context: ExtensionContext) {
  const hasAcceptedTerms = context.globalState.get<boolean>(acceptedTermsAndPoliciesKey);
  if (hasAcceptedTerms === true) return hasAcceptedTerms;

  const selection = await window.showInformationMessage(
    "By using this extension you agree to CodeScene's Terms and Privacy Policy",
    'Accept',
    'Decline',
    'View Terms & Policies'
  );

  Telemetry.instance.logUsage('termsAgreement', { selection });

  switch (selection) {
    case 'Accept':
      await context.globalState.update(acceptedTermsAndPoliciesKey, true);
      return true;
    case 'View Terms & Policies':
      void env.openExternal(Uri.parse('https://codescene.com/policies'));
      return await acceptTermsAndPolicies(context);
    default:
      throw new Error('You need to accept the terms to use this extension.');
  }
}
