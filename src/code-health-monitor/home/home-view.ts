import vscode, { Disposable, ExtensionContext, Position, ViewBadge, Webview, WebviewViewProvider } from 'vscode';
import throttle from 'lodash.throttle';
import Telemetry from '../../telemetry';
import { commonResourceRoots } from '../../webview-utils';
import { getHomeData, initBaseContent } from './home-html-utils';
import { AnalysisEvent, DeltaAnalysisEvent, DevtoolsAPI } from '../../devtools-api';
import { Baseline, CsExtensionState } from '../../cs-extension-state';
import { Delta } from '../../devtools-api/delta-model';
import { FileWithIssues } from '../tree-model';
import { showDocAtPosition } from '../../utils';
import {
  convertCWFCommitBaselineToVSCode,
  convertCWFDocTypeToVSCode,
  convertFileIssueToCWFDeltaItem,
  convertVSCodeCommitBaselineToCWF,
} from './cwf-parsers';
import { toDocsParams } from '../../documentation/commands';
import { CwfCommitBaselineType } from './cwf-types';
import { BackgroundServiceView } from '../background-view';

type CancelableVoid = (() => void) & { cancel(): void; flush(): void };

export function register(context: ExtensionContext, backgroundSeriveView: BackgroundServiceView) {
  const viewProvider = new HomeView(context, backgroundSeriveView);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('codescene.homeView', viewProvider));
}

// Find the VSCode equivalent file/function from webview payload
function getFileAndFunctionFromState(
  fileIssueMap: Map<string, FileWithIssues>,
  fileName: string,
  fn?: { name: string; startLine: number }
) {
  const locatedFile = fileIssueMap.get(fileName);
  if (!locatedFile) return;

  const locatedFn = fn
    ? locatedFile.functionLevelIssues.find((functionLevelIssues) => fn.name === functionLevelIssues.fnName)
    : undefined;

  return {
    file: locatedFile,
    fn: locatedFn
      ? {
          fnName: locatedFn?.fnName,
        }
      : undefined,
  };
}

function getFunctionPosition(fn: any | undefined): Position | undefined {
  return fn ? new Position(fn.range?.startLine, fn.range?.startColumn) : undefined;
}

export class HomeView implements WebviewViewProvider, Disposable {
  private disposables: Disposable[] = [];
  private view?: vscode.WebviewView;
  private baseContent: string = '';
  private initialized: boolean = false; // keep track of webview init state
  private fileIssueMap: Map<string, FileWithIssues> = new Map(); // Raw VSCode specific delta result, source of truth
  private backgroundServiceView: BackgroundServiceView;
  private ideContextData: {
    showOnboarding: boolean;
    fileDeltaData: any[];
    commitBaseline: string;
    autoRefactor: any;
    jobs: any[];
  } = {
    showOnboarding: false,
    fileDeltaData: [], // refined fileIssueMap in the CWF format
    commitBaseline: convertVSCodeCommitBaselineToCWF(CsExtensionState.baseline),
    autoRefactor: {
      activated: false, // indicate that the user has not approved the use of ACE yet
      disabled: false, // disable the visible button if visible: true
      visible: true, // Show any type of ACE functionality
    },
    jobs: [],
  };

  constructor(context: vscode.ExtensionContext, backgroundServiceView: BackgroundServiceView) {
    this.backgroundServiceView = backgroundServiceView;
    this.disposables.push(
      this,
      DevtoolsAPI.onDidAnalysisStateChange((e) => this.handleRunningsJobs(e)), // Detect changes to running analysis state
      DevtoolsAPI.onDidDeltaAnalysisComplete((e) => this.handleDeltaUpdate(e)), // Detect delta analysis complete
      CsExtensionState.onBaselineChanged(() => this.handleBaseLineChange()) // Detect change to commit baseline
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
    this.baseContent = initBaseContent(webView);
    this.update();
  }

  private update!: CancelableVoid;

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

    if (this.backgroundServiceView) {
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
    this.ideContextData.jobs = eventArray.map((fileName) => ({
      file: { fileName: fileName, type: 'deltaAnalysis', state: 'running' },
    }));
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

  // ### CWF Message handlers ###

  private async handleSelectCommitBaseLineMessage(commitBaseLineString: CwfCommitBaselineType) {
    const currentBaseline = CsExtensionState.baseline;
    const newBaseline = convertCWFCommitBaselineToVSCode(commitBaseLineString);
    if (newBaseline !== currentBaseline) {
      await CsExtensionState.setBaseline(newBaseline);
    }
  }

  private async handleGoToFunction(payload: {
    fileName: string;
    fn?: { name: string; range?: { startLine: number; endLine: number; startColumn: number; endColumn: number } };
  }) {
    const foundFileFunction = getFileAndFunctionFromState(this.fileIssueMap, payload.fileName);
    foundFileFunction?.file &&
      (await showDocAtPosition(foundFileFunction.file.document, getFunctionPosition(payload.fn)));
  }

  private handleAutoRefactor(payload: any) {
    console.log('Autorefactor NYI');
    // const foundFileFunction = getFileAndFunctionFromState(this.fileIssueMap, payload.fileName, {
    //   name: payload.fn.name,
    //   startLine: payload.fn.range.startLine,
    // });

    // if (!foundFileFunction) return;

    // void vscode.commands.executeCommand(
    //   'codescene.requestAndPresentRefactoring',
    //   foundFileFunction.file.document,
    //   'code-health-details',
    // );
  }

  private handleOpenDocs(payload: any) {
    const foundFileFunction = getFileAndFunctionFromState(
      this.fileIssueMap,
      payload.fileName,
      payload.fn
        ? {
            name: payload.fn.name,
            startLine: payload.fn.range.startLine,
          }
        : undefined
    );

    if (!foundFileFunction) return;

    const docsParams = toDocsParams(
      convertCWFDocTypeToVSCode(payload.docType),
      foundFileFunction.file?.document,
      getFunctionPosition(payload.fn)
    );
    if (docsParams) {
      void vscode.commands.executeCommand('codescene.openInteractiveDocsPanel', docsParams, 'code-health-details');
    }
  }

  private handleOpenSettings() {
    Telemetry.logUsage('control-center/open-settings');
    vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', '@ext:codescene.codescene-vscode').then(
      () => {},
      (err) => {
        void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:codescene.codescene-vscode');
      }
    );
  }

  // Handles messages from the homeView webview
  private async messageHandler(message: any) {
    switch (message.messageType) {
      case 'init':
        this.initialized = true;
        this.update();
        return;
      case 'commitBaseline':
        await this.handleSelectCommitBaseLineMessage(message.payload);
        return;
      case 'goto-function-location':
        await this.handleGoToFunction(message.payload);
        return;
      case 'request-and-present-refactoring':
        this.handleAutoRefactor(message.payload);
        return;
      case 'open-docs-for-function':
        this.handleOpenDocs(message.payload);
        return;
      case 'open-settings':
        this.handleOpenSettings();
        return;
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  // Update function for rendering webview. used by lodash throttle to limit number of rerenders
  async updateRaw() {
    const webView = this.view?.webview;
    if (!webView) return;

    if (this.initialized) {
      await webView.postMessage({
        messageType: 'update-renderer',
        payload: getHomeData({
          fileDeltaData: this.ideContextData.fileDeltaData,
          jobs: this.ideContextData.jobs,
          autoRefactor: this.ideContextData.autoRefactor,
          showOnboarding: false,
          commitBaseline: this.ideContextData.commitBaseline,
        }),
      });
    } else {
      webView.html = this.baseContent;
    }
  }
}
