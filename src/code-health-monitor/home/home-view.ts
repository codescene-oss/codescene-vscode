import vscode, { Disposable, ExtensionContext, WebviewViewProvider } from 'vscode';
import throttle from 'lodash.throttle';
import Telemetry from '../../telemetry';
import { commonResourceRoots } from '../../webview-utils';
import { getHomeData, analysisJobsToCwf } from './home-props-utils';
import { AnalysisEvent, DeltaAnalysisEvent, DevtoolsAPI } from '../../devtools-api';
import { CsExtensionState } from '../../cs-extension-state';
import { FileWithIssues } from '../file-with-issues';
import { convertFileIssueToCWFDeltaItem } from '../../centralized-webview-framework/cwf-parsers';
import { BackgroundServiceView } from '../background-view';
import { handleCWFMessage } from './cwf-message-handlers';
import { MessageToIDEType } from '../../centralized-webview-framework/types/messages';
import { AnalysisState, AutoRefactorConfig, FileDeltaData, Job } from '../../centralized-webview-framework/types';
import { initBaseContent } from '../../centralized-webview-framework/cwf-html-utils';
import { getAutoRefactorConfig } from '../../codescene-tab/webview/ace/acknowledgement/ace-acknowledgement-mapper';
import { automaticAnalysisEnabled, onDidChangeConfiguration } from '../../configuration';
import { monitorJobCounts } from './analysis-batch';
import { acquireGitApi, getRepoRootPath, onFileDeletedFromGit } from '../../git-utils';
import { logOutputChannel } from '../../log';
import { StaleFileRemover } from '../stale-file-remover';

type CancelableVoid = (() => void) & { cancel(): void; flush(): void };

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
  autoRefactor: AutoRefactorConfig;
  jobs: Job[];
  analysisState?: AnalysisState;
  totalCount?: number;
  remainingCount?: number;
}

export class HomeView implements WebviewViewProvider, Disposable {
  private disposables: Disposable[] = [];
  private view?: vscode.WebviewView;
  private baseContent: string = '';
  private initialized: boolean = false; // keep track of webview init state
  private fileIssueMap: Map<string, FileWithIssues> = new Map(); // Raw VSCode specific delta result, source of truth
  private backgroundServiceView: BackgroundServiceView; //handles badge updates
  private ideContextData: IdeContextData = {
    showOnboarding: false,
    fileDeltaData: [], // refined fileIssueMap in the CWF format
    autoRefactor: getAutoRefactorConfig(),
    jobs: [],
    analysisState: automaticAnalysisEnabled() ? 'idle' : 'stopped',
    remainingCount: 0,
  };

  constructor(context: vscode.ExtensionContext, backgroundServiceView: BackgroundServiceView) {
    this.backgroundServiceView = backgroundServiceView;

    this.disposables.push(
      this,
      DevtoolsAPI.onDidAnalysisStateChange((e) => this.handleRunningsJobs(e)), // Detect changes to running analysis state
      DevtoolsAPI.onDidDeltaAnalysisComplete((e) => this.handleDeltaUpdate(e)), // Detect delta analysis complete
      onFileDeletedFromGit((filePath) => this.handleFileDelete(filePath)), // Detect file deletions from Git
      CsExtensionState.onAceStateChanged(() => this.refreshAceState()), // Detect change to ACE status
      onDidChangeConfiguration('authToken', () => this.refreshAceState()), // Detect change to ACE auth token in settings
      onDidChangeConfiguration('enableAutomaticAnalysis', () => this.handleAutomaticAnalysisSetting())
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
    this.baseContent = initBaseContent(webView, this.homePayload());
    this.update();
  }

  public update!: CancelableVoid;

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
    const { document, result, updateMonitor, enrichment } = event;
    if (!updateMonitor) return;
    if (enrichment && !this.fileIssueMap.has(document.uri.fsPath)) return;

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

    this.updateActivityBadge();

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

  private applyAnalysisEvent(event: AnalysisEvent) {
    if (!automaticAnalysisEnabled()) {
      this.setStoppedAnalysis();
      return;
    }
    const repoRoots = this.repoRoots();
    const { totalCount, remainingCount } = monitorJobCounts(
      event.jobs,
      event.queued,
      event.queueCount,
      event.queueDone,
      repoRoots
    );
    this.ideContextData.jobs = analysisJobsToCwf(event.jobs, event.queued, repoRoots);
    this.ideContextData.analysisState = remainingCount > 0 ? 'running' : 'idle';
    this.ideContextData.totalCount = totalCount > 0 ? totalCount : undefined;
    this.ideContextData.remainingCount = remainingCount;
  }

  private repoRoots(): string[] {
    const git = acquireGitApi();
    if (!git) return [];
    return git.repositories.map((repo) => getRepoRootPath(repo));
  }

  private setStoppedAnalysis() {
    this.fileIssueMap.clear();
    this.rebuildFileDeltaData();
    this.ideContextData.jobs = [];
    this.ideContextData.analysisState = 'stopped';
    this.ideContextData.totalCount = undefined;
    this.ideContextData.remainingCount = 0;
    this.updateActivityBadge();
  }

  private handleAutomaticAnalysisSetting() {
    if (!automaticAnalysisEnabled()) {
      this.setStoppedAnalysis();
    } else if (this.ideContextData.analysisState === 'stopped') {
      this.ideContextData.analysisState = 'idle';
      this.updateActivityBadge();
    }
    this.update();
  }

  private homePayload() {
    return getHomeData({
      fileDeltaData: this.ideContextData.fileDeltaData,
      jobs: this.ideContextData.jobs,
      autoRefactor: this.ideContextData.autoRefactor,
      showOnboarding: false,
      analysisState: this.ideContextData.analysisState,
      totalCount: this.ideContextData.totalCount,
      remainingCount: this.ideContextData.remainingCount,
    });
  }

  // ### VSCode state handlers ###

  private handleRunningsJobs(event: AnalysisEvent) {
    this.applyAnalysisEvent(event);
    this.update();
  }

  private handleDeltaUpdate(event: DeltaAnalysisEvent) {
    if (!event.updateMonitor || !automaticAnalysisEnabled()) {
      return;
    }
    this.updateFileDeltaData(event);
    this.update();
  }

  private handleFileDelete(filePath: string) {
    this.removeTreeEntry(filePath);
    this.updateActivityBadge();
    this.rebuildFileDeltaData();
    this.update();
  }

  private refreshAceState() {
    this.ideContextData.autoRefactor = getAutoRefactorConfig();
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

  private updateActivityBadge() {
    this.backgroundServiceView.updateBadge(this.fileIssueMap.size);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  removeStaleFiles(changedFiles: Set<string>, visibleFiles: Set<string>, filesInJob: Set<string>): void {
    const staleFileRemover = new StaleFileRemover();
    const stalePaths = staleFileRemover.findStaleFiles(this.fileIssueMap, changedFiles, visibleFiles, filesInJob);

    for (const stalePath of stalePaths) {
      logOutputChannel.debug(`Removing stale file from Home View: ${stalePath}`);
      this.removeTreeEntry(stalePath);
    }

    if (stalePaths.length > 0) {
      this.updateActivityBadge();
      this.rebuildFileDeltaData();
      this.update();
    }
  }

  private async updateHomeRenderer() {
    const webView = this.view?.webview;
    if (!webView) return;
    await webView.postMessage({
      messageType: 'update-renderer',
      payload: this.homePayload(),
    });
  }

  // Update function for rendering webview. used by lodash throttle to limit number of rerenders
  async updateRaw() {
    const webView = this.view?.webview;
    if (!webView) return;

    if (this.initialized) {
      await this.updateHomeRenderer();
    } else {
      webView.html = this.baseContent;
    }
  }
}
