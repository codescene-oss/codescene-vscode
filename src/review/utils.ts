import * as vscode from 'vscode';
import { ReviewIssue, IssueDetails } from "./model";
import { getFunctionNameRange } from '../utils';

export function reviewIssueToDiagnostics(reviewIssue: ReviewIssue, document: vscode.TextDocument) {
  if (!reviewIssue.functions) {
    return [produceDiagnostic('info', new vscode.Range(0, 0, 0, 0), reviewIssue.category, reviewIssue.code)];
  }

  return reviewIssue.functions.map((func: IssueDetails) => {
    const lineNumber = func['start-line'] - 1;
    const [startColumn, endColumn] = getFunctionNameRange(document.lineAt(lineNumber).text, func.title);
    const range = new vscode.Range(lineNumber, startColumn, lineNumber, endColumn);

    let description;
    if (func.details) {
      description = `${reviewIssue.category} (${func.details})`;
    } else {
      description = reviewIssue.category;
    }

    return produceDiagnostic('warning', range, description, reviewIssue.code);
  });
}

export function produceDiagnostic(severity: string, range: vscode.Range, message: string, issueCode?: string) {
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
  if (issueCode) {
    const args = [vscode.Uri.parse(`csdoc:${issueCode}.md`)];
    const openDocCommandUri = vscode.Uri.parse(
      `command:markdown.showPreviewToSide?${encodeURIComponent(JSON.stringify(args))}`
    );
    diagnostic.code = {
      value: issueCode,
      target: openDocCommandUri,
    };
  }

  return diagnostic;
}