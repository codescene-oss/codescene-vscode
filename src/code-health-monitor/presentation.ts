import vscode from 'vscode';
import { DeltaTreeViewItem, issuesCount } from './tree-model';

export function registerDeltaAnalysisDecorations(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(new FileWithIssuesDecorationProvider()));
}

const fileWithIssuesScheme = 'codescene-file-with-issues';

class FileWithIssuesDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme === fileWithIssuesScheme) {
      const queryParams = new URLSearchParams(uri.query);
      const badge = queryParams.get('issues') || '';
      return {
        // badge, // TODO - use this badge? Otherwise maybe move the tooltip out to the model and remove this decorationprovider entirely
        tooltip: `Contains ${badge} issue(s) degrading code health`,
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
export function toFileWithIssuesUri(uri: vscode.Uri, children?: DeltaTreeViewItem[]): vscode.Uri {
  const queryParams = new URLSearchParams();
  children && queryParams.set('issues', issuesCount(children).toString());

  return uri.with({
    scheme: fileWithIssuesScheme,
    authority: 'codescene',
    query: queryParams.toString(),
  });
}
