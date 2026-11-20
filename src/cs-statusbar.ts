import vscode, { Disposable } from 'vscode';
import { AnalysisFeature, CsExtensionState, ExtensionAuthState } from './cs-extension-state';
import { isDefined } from './utils';
import { automaticAnalysisEnabled, onDidChangeConfiguration } from './configuration';
import { isLicensed, isLicenseResolving } from './auth/license-gate';

function signInRequired(auth: ExtensionAuthState): boolean {
  return auth.active && !isLicensed(auth) && !isLicenseResolving(auth.status);
}

interface StatusBarOptions {
  text: string;
  tooltip?: string;
  command?: string;
  background?: string;
}

export function analysisProgressTooltip(queueCount?: number): string {
  if (queueCount && queueCount > 0) {
    return `CodeScene analysis in progress (${queueCount} remaining)...`;
  }
  return 'CodeScene analysis in progress...';
}

export class CsStatusBar implements Disposable {
  private disposables: Disposable[] = [];

  private readonly analysisStatus: vscode.StatusBarItem;

  constructor() {
    this.disposables.push(onDidChangeConfiguration('enableAutomaticAnalysis', () => this.update()));
    this.analysisStatus = this.createStatusBarItem(
      'codescene.analysisStatusBarItem',
      vscode.StatusBarAlignment.Left,
      0
    );
  }

  update() {
    this.updateAnalysisStatus(CsExtensionState.stateProperties.features.analysis);
  }

  private updateAnalysisStatus(analysis: AnalysisFeature) {
    if (!analysis) return;

    const item = this.analysisStatus;

    if (this.handleErrorStates(analysis)) return;

    if (signInRequired(CsExtensionState.stateProperties.auth)) {
      this.setStatus(item, {
        text: 'CodeScene: Sign in required',
        tooltip: 'Sign in to get Code Health analysis',
        command: 'codescene.homeView.focus',
      });
      return;
    }

    if (!automaticAnalysisEnabled()) {
      this.setStatus(item, {
        text: '$(debug-pause) Analysis stopped',
        tooltip: 'Automatic analysis of changes is stopped. Click to start.',
        command: 'codescene.startAutomaticAnalysis',
        background: 'statusBarItem.warningBackground',
      });
      return;
    }

    if (analysis.analysisState === 'running') {
      this.setStatus(item, {
        text: '$(loading~spin) Analyzing...',
        tooltip: analysisProgressTooltip(analysis.queueCount),
        command: 'codescene.showLogOutput',
      });
      return;
    }

    if (analysis.state === 'loading' && analysis.analysisState === undefined) {
      this.setStatus(item, {
        text: '$(loading~spin) Initializing...',
        tooltip: 'Analysis feature is initializing...',
        command: 'codescene.showLogOutput',
      });
      return;
    }

    // A workspace with nothing to review never reports a runner state, so 'enabled' alone means ready.
    this.setStatus(item, {
      text: '$(cs-logo) Analysis',
      tooltip: 'Code Health Analysis ready',
      command: 'codescene.homeView.focus',
    });
  }

  private handleErrorStates(analysis: AnalysisFeature) {
    if (analysis.state !== 'error' && !analysis.error) return false;

    this.setStatus(this.analysisStatus, {
      text: '$(cs-logo) Error',
      background: 'statusBarItem.errorBackground',
      tooltip: isDefined(analysis.error) ? 'Click to open output log and clear errors.' : 'Click to open output log',
      command: isDefined(analysis.error) ? 'codescene.extensionState.clearErrors' : 'codescene.showLogOutput',
    });

    return true;
  }

  private createStatusBarItem(id: string, align: vscode.StatusBarAlignment, priority: number) {
    const item = vscode.window.createStatusBarItem(id, align, priority);
    item.show();
    return item;
  }

  private setStatus(item: vscode.StatusBarItem, options: StatusBarOptions) {
    item.text = options.text;
    item.tooltip = options.tooltip;
    item.command = options.command;
    item.backgroundColor = options.background ? new vscode.ThemeColor(options.background) : undefined;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
