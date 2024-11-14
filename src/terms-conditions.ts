import { commands, env, ExtensionContext, Uri, window } from 'vscode';
import { CsExtensionState } from './cs-extension-state';
import { registerCommandWithTelemetry } from './utils';

export function registerTermsAndPoliciesCmds(context: ExtensionContext) {
  context.subscriptions.push(
    registerCommandWithTelemetry({
      commandId: 'codescene.revokeTerms',
      handler: async () => {
        await CsExtensionState.setAcceptedTermsAndPolicies(undefined);
        void window.showInformationMessage('Terms and Privacy Policy agreement has now been revoked');
      },
    }),
    // Mostly for testing, users should rarely need to revoke this since it is controlled by a setting as well
    // The acceptance is just for notifying the user about the feature
    commands.registerCommand('codescene.revokeAceAcknowledgement', async () => {
      await CsExtensionState.setAcknowledgedAceUsage(undefined);
      void window.showInformationMessage('Accept ACE usage has now been revoked');
    })
  );
}

export async function acceptTermsAndPolicies(context: ExtensionContext): Promise<boolean> {
  if (CsExtensionState.acceptedTermsAndPolicies === true) return true;

  const selection = await window.showInformationMessage(
    "By using this extension you agree to CodeScene's Terms and Privacy Policy",
    'Accept',
    'Decline',
    'View Terms & Policies'
  );

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
