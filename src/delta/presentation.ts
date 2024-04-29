import vscode from 'vscode';

const scheme = 'codescene-deltaanalysis';

class DeltaAnalysisDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme === scheme) {
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

export function registerDeltaAnalysisDecorations(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(new DeltaAnalysisDecorationProvider()));
}

/**
 * An uri with codescene review information to be formatted by the ReviewDecorationProvider
 * @param uri
 * @returns
 */
export function toCsAnalysisUri(uri: vscode.Uri, issues?: number): vscode.Uri {
  const queryParams = new URLSearchParams();
  issues && queryParams.set('issues', issues.toString());

  const deltaAnalysisUri = uri.with({
    scheme,
    authority: 'codescene',
    query: queryParams.toString(),
  });
  return deltaAnalysisUri;
}
