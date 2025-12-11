import vscode, { Disposable, ExtensionContext, WebviewViewProvider } from 'vscode';
import throttle from 'lodash.throttle';
import Telemetry from '../../telemetry';
import { commonResourceRoots } from '../../webview-utils';
import { getHomeData, getLoginData } from './home-props-utils';
import { AnalysisEvent, DeltaAnalysisEvent, DevtoolsAPI } from '../../devtools-api';
import { CsExtensionState } from '../../cs-extension-state';
import { FileWithIssues } from '../file-with-issues';
import {
  convertFileIssueToCWFDeltaItem,
  convertVSCodeCommitBaselineToCWF,
} from '../../centralized-webview-framework/cwf-parsers';
import { BackgroundServiceView } from '../background-view';
import { handleCWFMessage } from './cwf-message-handlers';
import { CommitBaselineType, MessageToIDEType } from '../../centralized-webview-framework/types/messages';
import { AutoRefactorConfig, FileDeltaData, Job, LoginFlowStateType } from '../../centralized-webview-framework/types';
import { ignoreSessionStateFeatureFlag, initBaseContent } from '../../centralized-webview-framework/cwf-html-utils';
import { getAutoRefactorConfig } from '../../codescene-tab/webview/ace/acknowledgement/ace-acknowledgement-mapper';
import { onDidChangeConfiguration, getServerUrl } from '../../configuration';
import { onFileDeletedFromGit } from '../../git-utils';

type CancelableVoid = (() => void) & { cancel(): void; flush(): void };

function getUserName(accountLabel: string | undefined) {
  if (!accountLabel || accountLabel === 'null') return 'Signed in';
  return accountLabel;
}

let homeViewInstance: HomeView | undefined;

export function register(context: ExtensionContext, backgroundSeriveView: BackgroundServiceView) {
  const viewProvider = new HomeView(context, backgroundSeriveView);
  homeViewInstance = viewProvider;
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('codescene.homeView', viewProvider));
}

export function getHomeViewInstance(): HomeView | undefined {
  return homeViewInstance;
}

interface IdeContextData {
  showOnboarding: boolean;
  fileDeltaData: FileDeltaData[];
  commitBaseline: CommitBaselineType;
  autoRefactor: AutoRefactorConfig;
  jobs: Job[];
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

  private ideContextData: IdeContextData = {
    showOnboarding: false,
    fileDeltaData: [], // refined fileIssueMap in the CWF format
    commitBaseline: convertVSCodeCommitBaselineToCWF(CsExtensionState.baseline),
    autoRefactor: getAutoRefactorConfig(),
    jobs: [],
  };

  constructor(context: vscode.ExtensionContext, backgroundServiceView: BackgroundServiceView) {
    this.loginFlowState = { loginOpen: false, loginState: 'init' };
    this.backgroundServiceView = backgroundServiceView;

    this.disposables.push(
      this,
      DevtoolsAPI.onDidAnalysisStateChange((e) => this.handleRunningsJobs(e)), // Detect changes to running analysis state
      DevtoolsAPI.onDidDeltaAnalysisComplete((e) => this.handleDeltaUpdate(e)), // Detect delta analysis complete
      onFileDeletedFromGit((filePath) => this.handleFileDelete(filePath)), // Detect file deletions from Git
      CsExtensionState.onBaselineChanged(() => this.handleBaseLineChange()), // Detect change to commit baseline
      CsExtensionState.onSessionChanged(() => this.handleSessionChanged()), // Detect change to commit baseline
      CsExtensionState.onAceStateChanged(() => this.refreshAceState()), // Detect change to ACE status
      onDidChangeConfiguration('authToken', () => this.refreshAceState()) // Detect change to ACE auth token in settings
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
    const { document, result, updateMonitor } = event;
    if (!updateMonitor) return;

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

    this.updateBadgeIfSignedIn();

    this.rebuildFileDeltaData();
  }

  // Rebuild fileDeltaData from the current fileIssueMap
  private rebuildFileDeltaData() {
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
    if (!event.updateMonitor) {
      return;
    }
    this.updateFileDeltaData(event);
    this.update();
  }

  private handleFileDelete(filePath: string) {
    this.removeTreeEntry(filePath);
    this.updateBadgeIfSignedIn();
    this.rebuildFileDeltaData();
    this.update();
  }

  private handleBaseLineChange() {
    this.ideContextData.commitBaseline = convertVSCodeCommitBaselineToCWF(CsExtensionState.baseline);
    this.update();
  }

  private refreshAceState() {
    this.ideContextData.autoRefactor = getAutoRefactorConfig();
    this.update();
  }

  private handleSessionChanged() {
    this.session = CsExtensionState.session;
    if (this.session) {
      this.loginFlowState.loginOpen = false;
      this.updateBadgeIfSignedIn();
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

  private updateBadgeIfSignedIn() {
    if (this.backgroundServiceView && this.isSignedIn()) {
      this.backgroundServiceView.updateBadge(this.fileIssueMap.size);
    }
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
        user: { name: getUserName(this.session?.account.label) },
      }),
    });
  }

  private async updateLoginRenderer() {
    const webView = this.view?.webview;
    if (!webView) return;
    await webView.postMessage({
      messageType: 'update-renderer',
      payload: getLoginData({
        baseUrl: getServerUrl(),
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
