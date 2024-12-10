import vscode, { Uri } from 'vscode';
import { AnalysisEvent } from './analysis-common';
import { DeltaAnalyser } from './code-health-monitor/analyser';
import { ControlCenterViewProvider } from './control-center/view-provider';
import { CsStatusBar } from './cs-statusbar';
import { logOutputChannel } from './log';
import { AceAPI } from './refactoring/addon';
import { RefactoringCapabilities } from './refactoring/capabilities';
import Reviewer from './review/reviewer';
import { isDefined } from './utils';

export type FeatureState = 'loading' | 'enabled' | 'disabled' | 'error';

/**
 * state - indicates the state of the feature
 * error - holds the last error the feature has thrown. Note that error can be set even
 *    if state itself is not 'error'. This just indicates that there was a runtime error
 *    in the feature. It may very well be considered 'enabled' anyway.
 */
export interface CsFeature {
  state: FeatureState;
  error?: Error;
}

type AnalysisFeature = CsFeature & { analysisState?: RunnerState };
type RunnerState = 'running' | 'idle';

export type AceFeature = CsFeature & { refactorCapabilities?: RefactoringCapabilities };

interface CsFeatures {
  analysis: AnalysisFeature;
  ace: AceFeature;
}

export interface CsStateProperties {
  session?: vscode.AuthenticationSession;
  features: CsFeatures;
}

const acceptedTermsAndPoliciesKey = 'termsAndPoliciesAccepted';
const acknowledgedAceUsageKey = 'acknowledgedAceUsage';

/**
 * This class is used to handle the state of the extension. One part is managing and presenting
 * the state properties, the other part is to handle the state of components that are registered
 * when the user signs in and out of CodeScene.
 */
export class CsExtensionState {
  readonly stateProperties: CsStateProperties;
  readonly statusBar: CsStatusBar;
  readonly extensionUri: Uri;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controlCenterView: ControlCenterViewProvider
  ) {
    this.stateProperties = {
      features: {
        analysis: { state: 'loading' },
        ace: { state: 'loading' },
      },
    };
    this.extensionUri = context.extensionUri;
    context.subscriptions.push(
      vscode.commands.registerCommand('codescene.extensionState.clearErrors', () => {
        CsExtensionState.clearErrors();
        logOutputChannel.show();
      })
    );
    this.statusBar = new CsStatusBar(this.stateProperties);
    this.setupGlobalStateSync();
  }

  private setupGlobalStateSync() {
    this.context.globalState.setKeysForSync([acceptedTermsAndPoliciesKey, acknowledgedAceUsageKey]);
  }

  private static _instance: CsExtensionState;

  static init(context: vscode.ExtensionContext, controlCenterView: ControlCenterViewProvider) {
    CsExtensionState._instance = new CsExtensionState(context, controlCenterView);
  }

  static get acceptedTermsAndPolicies() {
    return this._instance.context.globalState.get<boolean>(acceptedTermsAndPoliciesKey);
  }

  static async setAcceptedTermsAndPolicies(value?: boolean) {
    await this._instance.context.globalState.update(acceptedTermsAndPoliciesKey, value);
  }

  static get acknowledgedAceUsage() {
    return this._instance.context.globalState.get<boolean>(acknowledgedAceUsageKey);
  }

  static async setAcknowledgedAceUsage(value?: boolean) {
    await this._instance.context.globalState.update(acknowledgedAceUsageKey, value);
  }

  static get stateProperties() {
    return CsExtensionState._instance.stateProperties;
  }

  static get extensionUri(): Uri {
    return CsExtensionState._instance.extensionUri;
  }

  /**
   * Returns the preflight response if ACE is enabled, otherwise undefined.
   */
  static get aceCapabilities(): RefactoringCapabilities | undefined {
    return CsExtensionState._instance.stateProperties.features.ace.refactorCapabilities;
  }

  /**
   * Call this after the Reviewer and DeltaAnalyser have been initialized.
   */
  static addListeners(context: vscode.ExtensionContext, aceApi: AceAPI) {
    context.subscriptions.push(
      Reviewer.instance.onDidReview(CsExtensionState._instance.handleAnalysisEvent),
      Reviewer.instance.onDidReviewFail(CsExtensionState._instance.handleAnalysisError),
      DeltaAnalyser.instance.onDidAnalyse(CsExtensionState._instance.handleAnalysisEvent),
      DeltaAnalyser.instance.onDidAnalysisFail(CsExtensionState._instance.handleAnalysisError)
    );
    context.subscriptions.push(
      aceApi.onDidRequestFail((error) => {
        CsExtensionState.setACEState({ ...CsExtensionState.stateProperties.features.ace, error });
      }),
      aceApi.onDidRefactoringRequest(async (evt) => {
        if (evt.type === 'end') {
          try {
            await evt.request.promise;
            // Reset error state when a request succeeds again
            CsExtensionState.setACEState({ ...CsExtensionState.stateProperties.features.ace, error: undefined });
          } catch (error) {}
        }
      })
    );
  }

  static clearErrors() {
    CsExtensionState.stateProperties.features.analysis.error = undefined;
    CsExtensionState.stateProperties.features.analysis.state = 'enabled';
    CsExtensionState.stateProperties.features.ace.error = undefined;
    CsExtensionState.stateProperties.features.ace.state = 'enabled';
    CsExtensionState._instance.updateStatusViews();
  }

  private handleAnalysisEvent(event: AnalysisEvent) {
    if (event.type === 'end') return;
    const analysisState = (CsExtensionState.stateProperties.features.analysis.analysisState =
      event.type === 'idle' ? 'idle' : 'running');
    CsExtensionState.setAnalysisState({ ...CsExtensionState.stateProperties.features.analysis, analysisState });
  }

  private handleAnalysisError(error: Error) {
    CsExtensionState.setAnalysisState({ ...CsExtensionState.stateProperties.features.analysis, error, state: 'error' });
  }

  private updateStatusViews() {
    CsExtensionState._instance.controlCenterView.update();
    CsExtensionState._instance.statusBar.update();
  }

  /**
   * Sets session state and updates the codescene.isSignedIn context variable.
   * It's used in package.json to conditionally enable/disable views.
   */
  static setSession(session?: vscode.AuthenticationSession) {
    const signedIn = isDefined(session);
    void vscode.commands.executeCommand('setContext', 'codescene.isSignedIn', signedIn);
    CsExtensionState._instance.stateProperties.session = session;
    if (!signedIn) {
      // this.csWorkspace.clearProjectAssociation(); <- when re-working Change Coupling...
      // CsExtensionState.setACEState('Not signed in'); // Ace cannot be active if not signed in
      return;
    }

    CsExtensionState._instance.updateStatusViews();
  }

  static get session(): vscode.AuthenticationSession | undefined {
    return CsExtensionState.stateProperties.session;
  }

  static setAnalysisState({ analysisState, error, state }: AnalysisFeature) {
    CsExtensionState.stateProperties.features = {
      ...CsExtensionState.stateProperties.features,
      analysis: { state: featureState({ state, error }), error, analysisState },
    };
    CsExtensionState._instance.updateStatusViews();
  }

  static setACEState({ refactorCapabilities, state, error }: AceFeature) {
    CsExtensionState.stateProperties.features = {
      ...CsExtensionState.stateProperties.features,
      ace: { refactorCapabilities, state: featureState({ state, error }), error },
    };
    CsExtensionState._instance.updateStatusViews();
  }
}

function featureState(feature: CsFeature) {
  if (isDefined(feature.error)) return 'error';
  return feature.state;
}
