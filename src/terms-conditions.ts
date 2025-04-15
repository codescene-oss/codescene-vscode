import { commands, env, ExtensionContext, Uri, window } from 'vscode';
import { CsExtensionState } from './cs-extension-state';
import Telemetry from './telemetry';

export function registerTermsAndPoliciesCmds(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('codescene-noace.revokeTerms', async () => {
      Telemetry.logUsage('revokeTerms');
      await CsExtensionState.setAcceptedTermsAndPolicies(undefined);
      void window.showInformationMessage('Terms and Privacy Policy agreement has now been revoked');
    })
  );
}

export async function acceptTermsAndPolicies(context: ExtensionContext): Promise<true> {
  if (CsExtensionState.acceptedTermsAndPolicies === true) return true;

  Telemetry.logUsage('terms_and_policies_shown');

  const selection = await window.showInformationMessage(
    "By using this extension you agree to CodeScene's Terms and Privacy Policy",
    'Accept',
    'Decline',
    'View Terms & Policies'
  );

  Telemetry.logUsage('terms_and_policies_response', { selection });

  switch (selection) {
    case 'Accept':
      await CsExtensionState.setAcceptedTermsAndPolicies(true);
      return true;
    case 'View Terms & Policies':
      void env.openExternal(Uri.parse('https://codescene.com/policies'));
      return await acceptTermsAndPolicies(context);
    default:
      throw new Error('You need to accept the terms to use this extension.');
  }
}
