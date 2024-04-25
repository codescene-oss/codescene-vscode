import vscode from 'vscode';
import { isDefined } from '../utils';

class ReviewDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme === 'codescene-review') {
      const queryParams = new URLSearchParams(uri.query);
      const score = isDefined(queryParams.get('score')) ? parseFloat(queryParams.get('score')!) : undefined;
      const badge = queryParams.get('issues') || '';
      const color = scoreToColor(score);
      return {
        color,
        badge,
      };
    }

    return undefined;
  }
}

export function registerReviewDecorations(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(new ReviewDecorationProvider()));
}

function scoreToColor(score?: number) {
  if (!isDefined(score)) return new vscode.ThemeColor('codescene.codeHealth.undefined');
  if (score >= 9) {
    return new vscode.ThemeColor('codescene.codeHealth.healthy');
  } else if (score >= 4) {
    return new vscode.ThemeColor('codescene.codeHealth.problematic');
  } else {
    return new vscode.ThemeColor('codescene.codeHealth.unhealthy');
  }
}
export function scoreToDescription(score?: number) {
  if (!isDefined(score)) return;
  if (score >= 9) {
    return 'Healthy';
  } else if (score >= 4) {
    return 'Problematic';
  } else {
    return 'Unhealthy';
  }
}

/**
 * An uri with codescene review information to be formatted by the ReviewDecorationProvider
 * @param uri
 * @returns
 */
export function toCsReviewUri(uri: vscode.Uri, { score, issues }: { score?: number; issues?: number }): vscode.Uri {
  const queryParams = new URLSearchParams();
  score && queryParams.set('score', score.toString());
  issues && queryParams.set('issues', issues.toString());

  const reviewUri = uri.with({
    scheme: 'codescene-review',
    authority: 'codescene',
    query: queryParams.toString(),
  });
  return reviewUri;
}
