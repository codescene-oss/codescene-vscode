import vscode from 'vscode';
import { DeltaFinding, issuesInFiles } from './tree-model';
import { isImprovement } from './model';

export function registerDeltaAnalysisDecorations(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(new DeltaAnalysisDecorationProvider()));
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(new DeltaIssueDecorationProvider()));
}

const deltaAnalysisScheme = 'codescene-deltaanalysis';

class DeltaAnalysisDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme === deltaAnalysisScheme) {
      const queryParams = new URLSearchParams(uri.query);
      const badge = queryParams.get('issues') || '';
      return {
        badge,
        tooltip: `${badge} function(s) with degrading code health`,
      };
    }

    return undefined;
  }
}

/**
 * An uri with codescene review information to be formatted by the ReviewDecorationProvider
 * @param uri
 * @returns
 */
export function toDeltaAnalysisUri(uri: vscode.Uri, children: DeltaFinding[]): vscode.Uri {
  const queryParams = new URLSearchParams();
  queryParams.set('issues', issuesInFiles(children).toString());

  return uri.with({
    scheme: deltaAnalysisScheme,
    authority: 'codescene',
    query: queryParams.toString(),
  });
}

const deltaIssueScheme = 'codescene-deltaissue';

class DeltaIssueDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme === deltaIssueScheme) {
      const queryParams = new URLSearchParams(uri.query);
      const refactorable = queryParams.get('refactorable');
      const isImprovement = queryParams.get('is-improvement') === 'true';
      return {
        badge: refactorable ? '✨' : undefined,
        tooltip: refactorable ? 'Can be refactored' : undefined,
        color: isImprovement ? undefined : new vscode.ThemeColor('descriptionForeground'),
      };
    }

    return undefined;
  }
}

export function toDeltaIssueUri(finding: DeltaFinding, refactorable?: boolean): vscode.Uri {
  const queryParams = new URLSearchParams();
  refactorable && queryParams.set('refactorable', refactorable.toString());
  queryParams.set('is-improvement', isImprovement(finding.changeType).toString());

  return vscode.Uri.from({
    scheme: deltaIssueScheme,
    authority: 'codescene',
    query: queryParams.toString(),
  });
}
