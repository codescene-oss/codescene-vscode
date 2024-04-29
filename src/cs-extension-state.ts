import { AxiosError } from 'axios';
import vscode from 'vscode';
import { CsRestApi } from './cs-rest-api';
import { CsStatusBar } from './cs-statusbar';
import { DeltaAnalyser } from './delta/analyser';
import { CsRefactoringCommands } from './refactoring/commands';
import { CsRefactoringRequests } from './refactoring/cs-refactoring-requests';
import { PreFlightResponse } from './refactoring/model';
import Reviewer from './review/reviewer';
import Telemetry from './telemetry';
import { isDefined } from './utils';
import { StatusViewProvider } from './webviews/status-view-provider';
import { AnalysisEvent } from './analysis-common';

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
export class CsExtensionState implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private stateProperties: CsStateProperties = {};

  private refactoringCommand: CsRefactoringCommands | undefined;
  private aceFeatureDisposables: vscode.Disposable[] = [];

  constructor(private readonly statusViewProvider: StatusViewProvider, private readonly statusBar: CsStatusBar) {
    this.disposables.push(
      vscode.commands.registerCommand('codescene.extensionState.clearErrors', () => {
        this.stateProperties.serviceErrors = undefined;
        this.updateStatusViews();
      })
    );
  }

  /**
   * Call this after the Reviewer and DeltaAnalyser have been initialized.
   */
  addListeners() {
    Reviewer.instance.onDidReview(this.handleAnalysisEvent.bind(this));
    Reviewer.instance.onDidReviewFail(this.handleError.bind(this));
    DeltaAnalyser.instance.onDidAnalyse(this.handleAnalysisEvent.bind(this));
    DeltaAnalyser.instance.onDidAnalysisFail(this.handleError.bind(this));
    CsRefactoringRequests.onDidRequestFail(this.handleError.bind(this));
  }

  private handleAnalysisEvent(event: AnalysisEvent) {
    this.stateProperties.analysisState = event.type === 'idle' ? 'idle' : 'running';
    this.statusBar.update(this.stateProperties);
  }

  private handleError(error: Error) {
    if (!this.stateProperties.serviceErrors) this.stateProperties.serviceErrors = [];
    this.stateProperties.serviceErrors.push(error);
    this.updateStatusViews();
  }

  updateStatusViews() {
    this.statusViewProvider.update(this.stateProperties);
    this.statusBar.update(this.stateProperties);
  }

  /**
   * Sets session state and updates the codescene.isSignedIn context variable.
   * This can be used in package.json to conditionally enable/disable views.
   */
  setSession(session?: vscode.AuthenticationSession) {
    const signedIn = isDefined(session);
    void vscode.commands.executeCommand('setContext', 'codescene.isSignedIn', signedIn);
    CsRestApi.instance.setSession(session);
    Telemetry.instance.setSession(session);
    this.stateProperties.session = session;
    if (!signedIn) {
      // this.csWorkspace.clearProjectAssociation(); <- when re-working Change Coupling...
      this.disableACE('Not signed in'); // Ace cannot be active if not signed in
      return;
    }

    this.updateStatusViews();
  }

  get session(): vscode.AuthenticationSession | undefined {
    return this.stateProperties.session;
  }

  setCliStatus(cliStatus: string | Error) {
    this.stateProperties.features = { ...this.stateProperties.features, codeHealthAnalysis: cliStatus };
    this.updateStatusViews();
  }

  enableACE(preFlight: PreFlightResponse, disposables: vscode.Disposable[]) {
    this.stateProperties.features = { ...this.stateProperties.features, ace: preFlight };
    this.aceFeatureDisposables = disposables;
    this.refactoringCommand?.enableRequestRefactoringsCmd(preFlight);
    this.updateStatusViews();
  }

  disableACE(reason: Error | string) {
    this.stateProperties.features = { ...this.stateProperties.features, ace: reason };

    this.refactoringCommand?.disableRequestRefactoringsCmd();
    this.aceFeatureDisposables.forEach((d) => d.dispose());
    this.aceFeatureDisposables = [];
    CsRefactoringRequests.deleteAll();
    this.updateStatusViews();
  }

  setRefactoringCommand(refactoringCommand: CsRefactoringCommands) {
    this.refactoringCommand = refactoringCommand;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    // (aceFeatureDisposables are added to context.subscriptions and disposed from there)
  }
}
