import * as vscode from 'vscode';
import { csSource } from '../cs-diagnostics';
import { categoryToDocsCode } from '../csdoc';
import { IssueDetails, ReviewIssue, ReviewResult } from './model';

export const chScorePrefix = 'Code health score: ';

// Finds the column range of the function name in the line of code that it appears in
export function getFunctionNameRange(line: string, functionName: string): [number, number] {
  const functionNameIndex = line.indexOf(functionName);
  if (functionNameIndex === -1) {
    const periodIndex = functionName.indexOf('.');
    if (periodIndex !== -1) {
      // Try again with the function name without the class name
      const functionNameWithoutClass = functionName.slice(periodIndex + 1);
      return getFunctionNameRange(line, functionNameWithoutClass);
    }
    return [0, 0];
  }
  return [functionNameIndex, functionNameIndex + functionName.length];
}

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

export function reviewIssueToDiagnostics(reviewIssue: ReviewIssue, document: vscode.TextDocument) {
  // File level issues
  if (!reviewIssue.functions) {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      reviewIssue.category,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.code = createCsDiagnosticCode(reviewIssue.category);
    return [diagnostic];
  }

  // Function level issues
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
    diagnostic.source = csSource;
    diagnostic.code = createCsDiagnosticCode(category);
    return diagnostic;
  });
}

export function fileAndFunctionLevelIssueCount(reviewResult: ReviewResult) {
  return reviewResult.review.reduce((prev, curr) => {
    if (curr.functions) {
      return prev + curr.functions.length; // a bunch of function level issues
    }
    return prev + 1; // a file level issue
  }, 0);
}
export function formatScore(score: number | void): string {
  return score ? `${+score.toFixed(2)}/10` : 'n/a';
}

export function reviewResultToDiagnostics(reviewResult: ReviewResult, document: vscode.TextDocument) {
  let diagnostics = reviewResult.review.flatMap((reviewIssue) => reviewIssueToDiagnostics(reviewIssue, document));

  if (reviewResult.score > 0) {
    const scoreDiagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      `${chScorePrefix}${formatScore(reviewResult.score)}`,
      vscode.DiagnosticSeverity.Information
    );
    return [scoreDiagnostic, ...diagnostics];
  } else {
    return diagnostics;
  }
}

/**
 * Creates a diagnostic code with a target that opens documentation for the issue category
 * @param category
 * @returns
 */
function createCsDiagnosticCode(category: string) {
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

/**
 * Used throughtout the extension to determine if a diagnostic code is a CodeScene diagnostic code
 *
 * @param code vscode.Diagnostic.code
 * @returns true if the code is a diagnostic code that is most probably created by createCsDiagnosticCode above
 */
export function isCsDiagnosticCode(
  code?: string | number | { value: string | number; target: vscode.Uri }
): code is { value: string; target: vscode.Uri } {
  if (typeof code !== 'object') return false;
  return code.target instanceof vscode.Uri && code.target.scheme === 'command';
}

export function getCsDiagnosticCode(code?: string | number | { value: string | number; target: vscode.Uri }): string {
  return isCsDiagnosticCode(code) ? code.value.toString() : 'unknown diagnostic code';
}
