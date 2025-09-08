import vscode, { Disposable, ExtensionContext, Position, ViewBadge, Webview, WebviewViewProvider } from 'vscode';
import throttle from 'lodash.throttle';
import Telemetry from '../../telemetry';
import { commonResourceRoots } from '../../webview-utils';
import { getHomeData, getLoginData, ignoreSessionStateFeatureFlag, initBaseContent } from './home-html-utils';
import { AnalysisEvent, DeltaAnalysisEvent, DevtoolsAPI } from '../../devtools-api';
import { CsExtensionState } from '../../cs-extension-state';
import { FileWithIssues } from '../tree-model';
import { convertFileIssueToCWFDeltaItem, convertVSCodeCommitBaselineToCWF } from './cwf-parsers';
import { BackgroundServiceView } from '../background-view';
import { handleCWFMessage } from './cwf-message-handlers';
import { CommitBaselineType, MessageToIDEType } from './types/messages';
import { AutoRefactorConfig, FileDeltaData, Job, LoginFlowStateType, LoginViewProps } from './types';

type CancelableVoid = (() => void) & { cancel(): void; flush(): void };

function getUserName(accountLabel: string | undefined) {
  if(!accountLabel || accountLabel === 'null') return 'Signed in';
  return accountLabel;
}

export function register(context: ExtensionContext, backgroundSeriveView: BackgroundServiceView) {
  const viewProvider = new HomeView(context, backgroundSeriveView);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('codescene.homeView', viewProvider));
}

export class HomeView implements WebviewViewProvider, Disposable {
  private disposables: Disposable[] = [];
  private view?: vscode.WebviewView;
  private baseContent: string = '';
  private initialized: boolean = false; // keep track of webview init state
  private fileIssueMap: Map<string, FileWithIssues> = new Map(); // Raw VSCode specific delta result, source of truth
  private backgroundServiceView: BackgroundServiceView; //handles badge updates

  private session: vscode.AuthenticationSession | undefined = CsExtensionState.session;
  private loginFlowState: LoginFlowStateType;

  private ideContextData: {
    showOnboarding: boolean;
    fileDeltaData: FileDeltaData[];
    commitBaseline: CommitBaselineType;
    autoRefactor: AutoRefactorConfig;
    jobs: Job[];
  } = {
    showOnboarding: false,
    fileDeltaData: [], // refined fileIssueMap in the CWF format
    commitBaseline: convertVSCodeCommitBaselineToCWF(CsExtensionState.baseline),
    autoRefactor: {
      activated: false, // indicate that the user has not approved the use of ACE yet
      disabled: false, // disable the visible button if visible: true
      visible: false, // Show any type of ACE functionality
    },
    jobs: [],
  };

  constructor(context: vscode.ExtensionContext, backgroundServiceView: BackgroundServiceView) {
    this.loginFlowState = { loginOpen: false, loginState: 'init' };
    this.backgroundServiceView = backgroundServiceView;
    this.disposables.push(
      this,
      DevtoolsAPI.onDidAnalysisStateChange((e) => this.handleRunningsJobs(e)), // Detect changes to running analysis state
      DevtoolsAPI.onDidDeltaAnalysisComplete((e) => this.handleDeltaUpdate(e)), // Detect delta analysis complete
      CsExtensionState.onBaselineChanged(() => this.handleBaseLineChange()), // Detect change to commit baseline
      CsExtensionState.onSessionChanged(() => this.handleSessionChanged()) // Detect change to commit baseline
    );
    // Limit number of re-renders
    this.update = throttle(this.updateRaw, 350, {
      leading: true,
      trailing: true,
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    this.view = webviewView;
    const webView = this.view.webview;
    webView.options = {
      enableScripts: true,
      localResourceRoots: commonResourceRoots(),
    };
    webView.onDidReceiveMessage(this.messageHandler, this, this.disposables);

    this.handleVisibilityEvents(webviewView);
    this.baseContent = initBaseContent(
      webView,
      getHomeData({
        fileDeltaData: this.ideContextData.fileDeltaData,
        jobs: this.ideContextData.jobs,
        autoRefactor: this.ideContextData.autoRefactor,
        showOnboarding: false,
        commitBaseline: this.ideContextData.commitBaseline,
        signedIn: this.isSignedIn(),
        user: { name: this.session?.account.label || 'Not set' },
      })
    );
    this.update();
  }

  public update!: CancelableVoid;

  //Setter of login state used by message handler
  setLoginFlowState(updatedLoginFlowState: LoginFlowStateType) {
    this.loginFlowState = updatedLoginFlowState;
  }

  //Setter of init state used by message handler
  setInitiated(updatedInitiated: boolean) {
    this.initialized = updatedInitiated;
  }

  //Getter of native file list used by message handler
  getFileIssueMap() {
    return this.fileIssueMap;
  }

  // Detect changes to the delta result, updates the list and lastly converts the data to CWF webview format
  private updateFileDeltaData(event: DeltaAnalysisEvent) {
    const { document, result } = event;
    const evtData = (fileWithIssues: FileWithIssues) => {
      const { nIssues, scoreChange } = fileWithIssues;
      return { visible: this.view?.visible, scoreChange, nIssues };
    };

    // Find the tree item matching the event document
    const fileWithIssues = this.fileIssueMap.get(document.uri.fsPath);
    if (fileWithIssues) {
      if (result) {
        // Update the existing entry if there are changes
        fileWithIssues.update(result, document);
        Telemetry.logUsage('code-health-monitor/file-updated', evtData(fileWithIssues));
      } else {
        // If there are no longer any issues, remove the entry from the tree
        this.removeTreeEntry(document.uri.fsPath);
      }
    } else if (result) {
      // No existing file entry found - add one if there are changes
      const newFileWithIssues = new FileWithIssues(result, document);
      this.fileIssueMap.set(document.uri.fsPath, newFileWithIssues);
      Telemetry.logUsage('code-health-monitor/file-added', evtData(newFileWithIssues));
    }

    if (this.backgroundServiceView && this.isSignedIn()) {
      this.backgroundServiceView.updateBadge(this.fileIssueMap.size);
    }

    this.ideContextData.fileDeltaData = [...this.fileIssueMap].map((d) => convertFileIssueToCWFDeltaItem(d[1]));
  }

  // Remove delta results that no longer should be rendered
  private removeTreeEntry(filePath: string) {
    this.fileIssueMap.delete(filePath);
    Telemetry.logUsage('code-health-monitor/file-removed', { visible: this.view?.visible });
  }

  // Convert VSCode jobs to CWF Jobs for rendering
  private updateJobsData(event: AnalysisEvent) {
    const eventArray = event.jobs ? Array.from(event.jobs) : [];
    this.ideContextData.jobs = eventArray.map(
      (fileName): Job => ({
        file: { fileName: fileName },
        type: 'deltaAnalysis',
        state: 'running',
      })
    );
  }

  // ### VSCode state handlers ###

  private handleRunningsJobs(event: AnalysisEvent) {
    this.updateJobsData(event);
    this.update();
  }

  private handleDeltaUpdate(event: DeltaAnalysisEvent) {
    this.updateFileDeltaData(event);
    this.update();
  }

  private handleBaseLineChange() {
    this.ideContextData.commitBaseline = convertVSCodeCommitBaselineToCWF(CsExtensionState.baseline);
    this.update();
  }
  private handleSessionChanged() {
    this.session = CsExtensionState.session;
    if (this.session) {
      this.loginFlowState.loginOpen = false;
      if (this.backgroundServiceView && this.isSignedIn()) {
        this.backgroundServiceView.updateBadge(this.fileIssueMap.size);
      }
    } else if (this.loginFlowState.loginState === 'pending' && this.loginFlowState.loginOpen) {
      // If the user has a pending login that fails we update the login flow state.
      this.loginFlowState.loginState = 'error';
    }
    this.update();
  }

  private handleVisibilityEvents(view: vscode.WebviewView) {
    // On first resolve ("resolveWebviewView is called when a view first becomes visible")
    Telemetry.logUsage('code-health-details/visibility', { visible: view.visible });
    view.onDidChangeVisibility(
      // On subsequent visibility changes (void event - use view.visible)
      () => {
        this.initialized = false; // onmounting the webview so will need to reinitiate it when opening codescene panel again.
        this.update.cancel(); // cancel any ongoing render updates that might have been throttled.
        Telemetry.logUsage('code-health-details/visibility', { visible: view.visible });
      },
      this,
      this.disposables
    );
  }

  // Handles messages from the homeView webview
  private async messageHandler(message: MessageToIDEType) {
    await handleCWFMessage(this, message);
    this.update();
  }

  private isSignedIn() {
    // if the ignoreSessionStateFeatureFlag is true we always consider the user signed in.
    return ignoreSessionStateFeatureFlag ? true : Boolean(this.session);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  private async updateHomeRenderer() {
    const webView = this.view?.webview;
    if (!webView) return;
    await webView.postMessage({
      messageType: 'update-renderer',
      payload: getHomeData({
        fileDeltaData: this.ideContextData.fileDeltaData,
        jobs: this.ideContextData.jobs,
        autoRefactor: this.ideContextData.autoRefactor,
        showOnboarding: false,
        commitBaseline: this.ideContextData.commitBaseline,
        signedIn: this.isSignedIn(),
        user: { name: getUserName(this.session?.account.label)},
      }),
    });
  }

  private async updateLoginRenderer() {
    const webView = this.view?.webview;
    if (!webView) return;
    await webView.postMessage({
      messageType: 'update-renderer',
      payload: getLoginData({
        baseUrl: 'https://codescene.io',
        availableProjects: [],
        state: this.loginFlowState.loginState,
        user: { name: getUserName(this.session?.account.label) },
      }),
    });
  }

  // Update function for rendering webview. used by lodash throttle to limit number of rerenders
  async updateRaw() {
    const webView = this.view?.webview;
    if (!webView) return;

    if (this.initialized) {
      if (this.loginFlowState.loginOpen) {
        await this.updateLoginRenderer();
      } else {
        await this.updateHomeRenderer();
      }
    } else {
      webView.html = this.baseContent;
    }
  }
}
