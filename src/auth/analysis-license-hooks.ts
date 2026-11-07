import vscode from 'vscode';
import { automaticAnalysisEnabled } from '../configuration';
import { DevtoolsAPI } from '../devtools-api';
import type { LicenseHooks } from './license-gate';

export interface LicensedAnalysis {
  watch(): { setEnabled(enabled: boolean): void; resync(): Promise<void> } | undefined;
  observer(): { reviewOpenDocuments(reason: string): void } | undefined;
}

export function analysisLicenseHooks(analysis: LicensedAnalysis): LicenseHooks {
  return {
    onLicensed() {
      analysis.watch()?.setEnabled(automaticAnalysisEnabled());
      analysis.observer()?.reviewOpenDocuments('licensed');
      void vscode.commands.executeCommand('codescene.ace.setEnabled', true);
    },
    onUnlicensed() {
      DevtoolsAPI.clearQueue();
      analysis.watch()?.setEnabled(false);
      DevtoolsAPI.clearAllResults();
    },
    onServerRelicensed() {
      void analysis.watch()?.resync();
    },
  };
}
