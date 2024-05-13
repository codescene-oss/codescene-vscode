import * as vscode from 'vscode';
import { csSource } from '../diagnostics/cs-diagnostics';
import { createCsDiagnosticCode, issueToRange } from '../diagnostics/utils';
import { IssueDetails, ReviewIssue, ReviewResult } from './model';

export const chScorePrefix = 'Code health score: ';

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
    const range = issueToRange(
      reviewIssue.category,
      { name: func.title, startLine: func['start-line'], endLine: func['end-line'] },
      document
    );

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

export function roundScore(score: number): number {
  return +score.toFixed(2);
}
export function formatScore(score: number | void): string {
  return score ? `${roundScore(score)}/10` : 'n/a';
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
