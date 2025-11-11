import vscode from 'vscode';
import { ChangeType, Delta } from '../devtools-api/delta-model';
import { formatScore } from '../review/utils';
import { pluralize } from '../utils';
import { DeltaTreeViewItem, countInTree } from './tree-model';

export const okColor = new vscode.ThemeColor('terminal.ansiGreen');
export const errorColor = new vscode.ThemeColor('errorForeground');

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
      const badge = queryParams.get('issues');
      if (!badge || Number(badge) < 1) return;
      return {
        badge: (Number(badge) > 99) ? "99" : badge,
        tooltip: `${badge} ${pluralize('issue', Number(badge))} can be improved`,
      };
    }
  }
}

/**
 * An uri with codescene review information to be formatted by the ReviewDecorationProvider
 * @param uri
 * @returns
 */
export function toFileWithIssuesUri(uri: vscode.Uri, children?: DeltaTreeViewItem[]): vscode.Uri {
  const queryParams = new URLSearchParams();
  children && queryParams.set('issues', countInTree(children, hasImprovementOpportunity).toString());

  return uri.with({
    scheme: fileWithIssuesScheme,
    authority: 'codescene',
    query: queryParams.toString(),
  });
}

export function scorePresentation(delta: Delta) {
  if (delta['old-score'] === delta['new-score']) return formatScore(delta['old-score']);
  const oldScorePresentation = delta['old-score'] || 'n/a';
  const newScorePresentation = delta['new-score'] || 'n/a';
  return `${oldScorePresentation} → ${newScorePresentation}`;
}
export function isDegradation(changeType: ChangeType) {
  return changeType === 'degraded' || changeType === 'introduced';
}

export function hasImprovementOpportunity(changeType: ChangeType) {
  return isDegradation(changeType) || changeType === 'improved';
}
