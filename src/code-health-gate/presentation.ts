import vscode from 'vscode';
import { DeltaFunctionInfo, DeltaTreeViewItem, countIssuesIn } from './tree-model';

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
        tooltip: `${badge} issue(s) with degrading code health`,
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
export function toDeltaAnalysisUri(uri: vscode.Uri, children?: DeltaTreeViewItem[]): vscode.Uri {
  const queryParams = new URLSearchParams();
  children && queryParams.set('issues', countIssuesIn(children).toString());

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
      return {
        badge: refactorable ? '✨' : undefined,
        tooltip: refactorable ? 'Can be refactored' : undefined,
      };
    }

    return undefined;
  }
}

export function toDeltaFunctionUri(functionInfo: DeltaFunctionInfo, refactorable?: boolean): vscode.Uri {
  const queryParams = new URLSearchParams();
  refactorable && queryParams.set('refactorable', refactorable.toString());

  return vscode.Uri.from({
    scheme: deltaIssueScheme,
    authority: 'codescene',
    query: queryParams.toString(),
  });
}
