import vscode from 'vscode';
import { refreshMergeBaseBaselines, runGitChangeLister } from './code-health-monitor/addon';
import { clearMainBranchCandidatesCache } from './git-utils';
import { gitRootFromCodesceneConfigUri } from './git/codescene-repo-config';
import CsDiagnostics from './diagnostics/cs-diagnostics';
import { logOutputChannel } from './log';
import { loadDocumentForBackgroundReview } from './review/review-document-loader';

export interface RulesChangeReReviewDeps {
  getVisibleFiles: () => Set<string>;
  getMonitorFilePaths: () => Iterable<string>;
}

export function reReviewAfterCodeHealthRulesChange(deps: RulesChangeReReviewDeps): void {
  const visibleFiles = deps.getVisibleFiles();
  const filesToReview = new Set(visibleFiles);
  for (const filePath of deps.getMonitorFilePaths()) {
    filesToReview.add(filePath);
  }

  filesToReview.forEach((filePath) => {
    const isVisible = visibleFiles.has(filePath);
    void loadDocumentForBackgroundReview(filePath, { allowOpenTextDocument: isVisible }).then((document) => {
      if (!document) {
        logOutputChannel.warn(`Failed to re-review file after rules change: ${filePath}`);
        return;
      }
      CsDiagnostics.review(document, { skipMonitorUpdate: false, updateDiagnosticsPane: isVisible });
    });
  });
}

export interface ConfigChangeReReviewDeps {
  getVisibleFiles: () => Set<string>;
}

export function handleCodesceneConfigChange(uri: vscode.Uri, deps: ConfigChangeReReviewDeps): void {
  const gitRoot = gitRootFromCodesceneConfigUri(uri);
  if (gitRoot) {
    clearMainBranchCandidatesCache(gitRoot);
  } else {
    clearMainBranchCandidatesCache();
  }

  refreshMergeBaseBaselines();
  void runGitChangeLister();

  deps.getVisibleFiles().forEach((filePath) => {
    const fileUri = vscode.Uri.file(filePath);
    void vscode.workspace.openTextDocument(fileUri).then(
      (document) => {
        CsDiagnostics.review(document, { skipMonitorUpdate: true, updateDiagnosticsPane: true });
      },
      (e) => {
        logOutputChannel.warn(`Failed to re-review file after config change: ${filePath}`, e);
      }
    );
  });
}
