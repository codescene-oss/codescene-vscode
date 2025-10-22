import vscode, { Uri } from 'vscode';
import { CsStatusBar } from './cs-statusbar';
import { AnalysisEvent, DevtoolsAPI } from './devtools-api';
import { logOutputChannel } from './log';
import { isDefined } from './utils';

export type FeatureState = 'loading' | 'enabled' | 'disabled' | 'error' | 'offline';

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

export enum Baseline {
  head = 1,
  branchCreation = 2,
  default = 3,
}

export type AnalysisFeature = CsFeature & { analysisState?: RunnerState };
type RunnerState = 'running' | 'idle';

interface CsFeatures {
  analysis: AnalysisFeature;
  ace: CsFeature;
}

export interface CsStateProperties {
  session?: vscode.AuthenticationSession;
  features: CsFeatures;
}

const acknowledgedAceUsageKey = 'acknowledgedAceUsage';
const baselineKey = 'baseline';
const telemetryNoticeShownKey = 'telemetryNoticeShown';

/**
 * This class is used to handle the state of the extension. One part is managing and presenting
 * the state properties, the other part is to handle the state of components that are registered
 * when the user signs in and out of CodeScene.
 */
export class CsExtensionState {
  readonly stateProperties: CsStateProperties;
  readonly statusBar: CsStatusBar;
  readonly extensionUri: Uri;

  private baselineChangedEmitter = new vscode.EventEmitter<void>();
  readonly onBaselineChanged = this.baselineChangedEmitter.event;

  private aceStateChangedEmitter = new vscode.EventEmitter<void>();
  readonly onAceStateChanged = this.aceStateChangedEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
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
    this.statusBar = new CsStatusBar();
    this.setupGlobalStateSync();
  }

  private setupGlobalStateSync() {
    this.context.globalState.setKeysForSync([
      acknowledgedAceUsageKey,
      baselineKey,
      telemetryNoticeShownKey,
    ]);
  }

  private static _instance: CsExtensionState;

  static init(context: vscode.ExtensionContext) {
    CsExtensionState._instance = new CsExtensionState(context);
  }

  static get acknowledgedAceUsage() {
    return this._instance.context.globalState.get<boolean>(acknowledgedAceUsageKey);
  }

  static async setAcknowledgedAceUsage(value?: boolean) {
    await this._instance.context.globalState.update(acknowledgedAceUsageKey, value);
  }

  static get baseline(): Baseline {
    return this._instance.context.globalState.get<Baseline>(baselineKey) || Baseline.default;
  }

  static async setBaseline(value: Baseline) {
    await this._instance.context.globalState.update(baselineKey, value);
    this._instance.baselineChangedEmitter.fire();
  }

  static get onBaselineChanged() {
    return this._instance.onBaselineChanged;
  }

  static get telemetryNoticeShown() {
    return this._instance.context.globalState.get<boolean>(telemetryNoticeShownKey);
  }

  static async setTelemetryNoticeShown(value?: boolean) {
    await this._instance.context.globalState.update(telemetryNoticeShownKey, value);
  }

  static get stateProperties() {
    return CsExtensionState._instance.stateProperties;
  }

  static get extensionUri(): Uri {
    return CsExtensionState._instance.extensionUri;
  }

  /**
   * Call this after the Reviewer and DeltaAnalyser have been initialized.
   */
  static addListeners(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      DevtoolsAPI.onDidAnalysisStateChange(CsExtensionState._instance.handleAnalysisEvent),
      DevtoolsAPI.onDidAnalysisFail(CsExtensionState._instance.handleAnalysisError)
    );
    context.subscriptions.push(
      DevtoolsAPI.onDidRefactoringFail((error) => {
        CsExtensionState.setACEState({ ...CsExtensionState.stateProperties.features.ace, error });
      }),
      DevtoolsAPI.onDidRefactoringRequest(async (evt) => {
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
    CsExtensionState.setAnalysisState({
      ...CsExtensionState.stateProperties.features.analysis,
      analysisState: event.state,
    });
  }

  private handleAnalysisError(error: Error) {
    CsExtensionState.setAnalysisState({ ...CsExtensionState.stateProperties.features.analysis, error, state: 'error' });
  }

  private updateStatusViews() {
    // CsExtensionState._instance.controlCenterView.update();
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
      // this.csWorkspace.clearProjectAssociation(); <- if/when re-working Change Coupling...
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

  static setACEState({ state, error }: CsFeature) {
    CsExtensionState.stateProperties.features = {
      ...CsExtensionState.stateProperties.features,
      ace: { state: featureState({ state, error }), error },
    };
    
    CsExtensionState._instance.updateStatusViews();
    CsExtensionState._instance.aceStateChangedEmitter.fire();
  }

    static get onAceStateChanged() {
    return this._instance.onAceStateChanged;
  }
}

function featureState(feature: CsFeature) {
  if (isDefined(feature.error)) return 'error';
  return feature.state;
}
