import * as vscode from 'vscode';
import { ReviewIssue, IssueDetails } from './model';
import { getFunctionNameRange } from '../utils';

function issueToRange(issueCode: string, issue: IssueDetails, document: vscode.TextDocument): vscode.Range {
  const startLine = issue['start-line'] - 1;
  const startLineText = document.lineAt(startLine).text;

  // Complex conditional does NOT occur on the same line as the function name,
  // it occurs on the line(s) of the conditional itself.
  if (issueCode === 'complex-conditional') {
    const startColumn = startLineText.search(/\S|$/);
    const endColumn = 0;
    return new vscode.Range(startLine, startColumn > 0 ? startColumn : 0, issue['end-line'], endColumn);
  }

  // Other issues occur on the same line as the function name and we use the
  // function name to find the range
  const [startColumn, endColumn] = getFunctionNameRange(startLineText, issue.title);
  return new vscode.Range(startLine, startColumn, startLine, endColumn);
}

export function reviewIssueToDiagnostics(reviewIssue: ReviewIssue, document: vscode.TextDocument) {
  if (!reviewIssue.functions) {
    return [produceDiagnostic('info', new vscode.Range(0, 0, 0, 0), reviewIssue.category, reviewIssue)];
  }

  return reviewIssue.functions.map((func: IssueDetails) => {
    const range = issueToRange(reviewIssue.code, func, document);

    let description;
    if (func.details) {
      description = `${reviewIssue.category} (${func.details})`;
    } else {
      description = reviewIssue.category;
    }

    return produceDiagnostic('warning', range, description, reviewIssue);
  });
}

export function produceDiagnostic(severity: string, range: vscode.Range, message: string, issue?: ReviewIssue) {
  let diagnosticSeverity: vscode.DiagnosticSeverity;
  switch (severity) {
    case 'info':
      diagnosticSeverity = vscode.DiagnosticSeverity.Information;
      break;
    case 'warning':
      diagnosticSeverity = vscode.DiagnosticSeverity.Warning;
      break;
    case 'error':
      diagnosticSeverity = vscode.DiagnosticSeverity.Error;
      break;
    default:
      diagnosticSeverity = vscode.DiagnosticSeverity.Error;
  }

  const diagnostic = new vscode.Diagnostic(range, message, diagnosticSeverity);
  diagnostic.source = 'CodeScene';

  // We don't want to add diagnostics for the "file level" issues, because it looks a bit ugly.
  // Instead, they are only shown as code lenses.
  if (issue?.code) {
    const args = [vscode.Uri.parse(`csdoc:${issue.code}.md`)];
    const openDocCommandUri = vscode.Uri.parse(
      `command:markdown.showPreviewToSide?${encodeURIComponent(JSON.stringify(args))}`
    );
    diagnostic.code = {
      value: JSON.stringify({code: issue.code, category: issue.category}),
      target: openDocCommandUri,
    };
  }

  return diagnostic;
}
