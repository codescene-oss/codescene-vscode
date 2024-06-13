import { AxiosError } from 'axios';
import vscode from 'vscode';
import { AnalysisEvent } from './analysis-common';
import { DeltaAnalyser } from './code-health-gate/analyser';
import { CsRestApi } from './cs-rest-api';
import { CsStatusBar } from './cs-statusbar';
import { CsRefactoringRequests } from './refactoring/cs-refactoring-requests';
import { PreFlightResponse, isPreFlightResponse } from './refactoring/model';
import Reviewer from './review/reviewer';
import Telemetry from './telemetry';
import { isDefined } from './utils';
import { StatusViewProvider, registerStatusViewProvider } from './webviews/status-view-provider';

export interface CsFeatures {
  codeHealthAnalysis?: string | Error;
  ace?: PreFlightResponse | Error | string;
}

export type RunnerState = 'running' | 'idle';

export interface CsStateProperties {
  session?: vscode.AuthenticationSession;
  features?: CsFeatures;
  analysisState?: RunnerState;
  serviceErrors?: Array<Error | AxiosError>;
}

/**
 * This class is used to handle the state of the extension. One part is managing and presenting
 * the state properties, the other part is to handle the state of components that are registered
 * when the user signs in and out of CodeScene.
 */
export class CsExtensionState {
  readonly stateProperties: CsStateProperties = {};
  readonly statusViewProvider: StatusViewProvider;
  readonly statusBar: CsStatusBar;

  constructor(context: vscode.ExtensionContext) {
    this.statusViewProvider = registerStatusViewProvider(context);
    this.statusBar = new CsStatusBar();
  }

  private static _instance: CsExtensionState;

  static init(context: vscode.ExtensionContext) {
    CsExtensionState._instance = new CsExtensionState(context);
  }
  static get stateProperties() {
    return CsExtensionState._instance.stateProperties;
  }

  static get cliPath(): string {
    const cliPath = CsExtensionState._instance.stateProperties.features?.codeHealthAnalysis;
    if (typeof cliPath !== 'string') {
      throw new Error(`CodeScene devtools binary path not set (${cliPath})`);
    }
    return cliPath;
  }

  /**
   * Returns the preflight response if ACE is enabled, otherwise undefined.
   */
  static get acePreflight(): PreFlightResponse | undefined {
    const ace = CsExtensionState._instance.stateProperties.features?.ace;
    return isPreFlightResponse(ace) ? ace : undefined;
  }

  /**
   * Call this after the Reviewer and DeltaAnalyser have been initialized.
   */
  static addListeners() {
    Reviewer.instance.onDidReview(CsExtensionState._instance.handleAnalysisEvent);
    Reviewer.instance.onDidReviewFail(CsExtensionState._instance.handleError);
    DeltaAnalyser.instance.onDidAnalyse(CsExtensionState._instance.handleAnalysisEvent);
    DeltaAnalyser.instance.onDidAnalysisFail(CsExtensionState._instance.handleError);
    CsRefactoringRequests.onDidRequestFail(CsExtensionState._instance.handleError);
  }

  static clearErrors() {
    CsExtensionState.stateProperties.serviceErrors = undefined;
    CsExtensionState._instance.updateStatusViews();
  }

  private handleAnalysisEvent(event: AnalysisEvent) {
    CsExtensionState.stateProperties.analysisState = event.type === 'idle' ? 'idle' : 'running';
    CsExtensionState._instance.updateStatusViews(); // TODO - flag to update status bar only
  }

  private handleError(error: Error) {
    if (!CsExtensionState.stateProperties.serviceErrors) CsExtensionState.stateProperties.serviceErrors = [];
    CsExtensionState.stateProperties.serviceErrors.push(error);
    CsExtensionState._instance.updateStatusViews();
  }

  private updateStatusViews() {
    // TODO - statusviews can read from stateProperties directly
    CsExtensionState._instance.statusViewProvider.update(CsExtensionState.stateProperties);
    CsExtensionState._instance.statusBar.update(CsExtensionState.stateProperties);
  }

  /**
   * Sets session state and updates the codescene.isSignedIn context variable.
   * It's used in package.json to conditionally enable/disable views.
   */
  static setSession(session?: vscode.AuthenticationSession) {
    const signedIn = isDefined(session);
    void vscode.commands.executeCommand('setContext', 'codescene.isSignedIn', signedIn);
    CsRestApi.instance.setSession(session);
    Telemetry.instance.setSession(session);
    CsExtensionState._instance.stateProperties.session = session;
    if (!signedIn) {
      // this.csWorkspace.clearProjectAssociation(); <- when re-working Change Coupling...
      CsExtensionState.setACEState('Not signed in'); // Ace cannot be active if not signed in
      return;
    }

    CsExtensionState._instance.updateStatusViews();
  }

  static get session(): vscode.AuthenticationSession | undefined {
    return CsExtensionState.stateProperties.session;
  }

  static setCliState(cliState: string | Error) {
    CsExtensionState.stateProperties.features = {
      ...CsExtensionState.stateProperties.features,
      codeHealthAnalysis: cliState,
    };
    CsExtensionState._instance.updateStatusViews();
  }

  static setACEState(aceState: PreFlightResponse | Error | string) {
    CsExtensionState.stateProperties.features = { ...CsExtensionState.stateProperties.features, ace: aceState };
    CsExtensionState._instance.updateStatusViews();
  }
}
