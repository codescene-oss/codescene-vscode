import vscode from 'vscode';
import { DeltaTreeViewItem, countIssuesIn } from './tree-model';
import { pluralize } from '../utils';

export function registerDeltaAnalysisDecorations(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(new DeltaAnalysisDecorationProvider()));
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(new DeltaFnInfoDecorationProvider()));
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
export function toDeltaAnalysisUri(uri: vscode.Uri, children?: DeltaTreeViewItem[]): vscode.Uri {
  const queryParams = new URLSearchParams();
  children && queryParams.set('issues', countIssuesIn(children).toString());

  return uri.with({
    scheme: deltaAnalysisScheme,
    authority: 'codescene',
    query: queryParams.toString(),
  });
}

const deltaFnInfoScheme = 'codescene-deltafninfo';

class DeltaFnInfoDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme === deltaFnInfoScheme) {
      const queryParams = new URLSearchParams(uri.query);
      const refactorable = queryParams.get('refactorable') === 'true';
      const issues = queryParams.get('issues');
      const issuesText = issues && `Contains ${issues} ${pluralize('issue', Number(issues))} degrading code health`;
      const refactorableText = refactorable && 'Auto-refactor available';
      const tooltip = `${issuesText ? issuesText : ''}${refactorableText ? ` • ${refactorableText}` : ''}`;
      return {
        badge: issues || '',
        tooltip,
      };
    }

    return undefined;
  }
}

export function toDeltaFunctionUri(issues: number, refactorable?: boolean): vscode.Uri {
  const queryParams = new URLSearchParams();
  issues && queryParams.set('issues', issues.toString());
  refactorable && queryParams.set('refactorable', refactorable.toString());

  return vscode.Uri.from({
    scheme: deltaFnInfoScheme,
    authority: 'codescene',
    query: queryParams.toString(),
  });
}
