import * as vscode from 'vscode';
import { ReviewIssue, IssueDetails } from './model';
import { getFunctionNameRange } from '../utils';
import { categoryToDocsCode } from '../csdoc';

function issueToRange(category: string, issue: IssueDetails, document: vscode.TextDocument): vscode.Range {
  const startLine = issue['start-line'] - 1;
  const startLineText = document.lineAt(startLine).text;

  // Complex conditional does NOT occur on the same line as the function name,
  // it occurs on the line(s) of the conditional itself.
  if (category === 'Complex Conditional') {
    const startColumn = startLineText.search(/\S|$/);
    const endColumn = 0;
    return new vscode.Range(startLine, startColumn > 0 ? startColumn : 0, issue['end-line'], endColumn);
  }

  // Other issues occur on the same line as the function name and we use the
  // function name to find the range
  const [startColumn, endColumn] = getFunctionNameRange(startLineText, issue.title);
  return new vscode.Range(startLine, startColumn, startLine, endColumn);
}

export function reviewIssueToDiagnostics(
  reviewIssue: ReviewIssue,
  document: vscode.TextDocument,
  supportedCodeSmells?: string[]
) {
  if (!reviewIssue.functions) {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      reviewIssue.category,
      vscode.DiagnosticSeverity.Information
    );
    diagnostic.code = createDiagnosticCode(reviewIssue.category);
    return [diagnostic];
  }

  return reviewIssue.functions.map((func: IssueDetails) => {
    const category = reviewIssue.category;
    const range = issueToRange(reviewIssue.category, func, document);

    let message;
    if (func.details) {
      message = `${category} (${func.details})`;
    } else {
      message = category;
    }
    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
    diagnostic.source = 'cs'; // Shown in the Problems view
    diagnostic.code = createDiagnosticCode(category);
    return diagnostic;
  });
}

/**
 * Creates a diagnostic code with a target that opens documentation for the issue category
 * @param category
 * @returns
 */
function createDiagnosticCode(category: string) {
  const docsCode = categoryToDocsCode(category);
  const args = [vscode.Uri.parse(`csdoc:${docsCode}.md`)];
  const openDocCommandUri = vscode.Uri.parse(
    `command:markdown.showPreviewToSide?${encodeURIComponent(JSON.stringify(args))}`
  );
  return {
    value: category,
    target: openDocCommandUri,
  };
}
