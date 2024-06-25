import * as vscode from 'vscode';
import { csSource } from '../diagnostics/cs-diagnostics';
import { fnCoordinateToRange } from '../diagnostics/utils';
import { isDefined } from '../utils';
import { IssueDetails, ReviewIssue, ReviewResult } from './model';

const chScorePrefix = 'Code health score: ';
const noApplicationCode = 'No application code detected for scoring';

export function isGeneralDiagnostic(diagnostic: vscode.Diagnostic) {
  const { message } = diagnostic;
  return message.startsWith(chScorePrefix);
}

function createGeneralDiagnostic(reviewResult: ReviewResult) {
  const scoreText =
    reviewResult.score === 0
      ? `${chScorePrefix}${noApplicationCode}`
      : `${chScorePrefix}${formatScore(reviewResult.score)}`;
  return new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), scoreText, vscode.DiagnosticSeverity.Information);
}

export function reviewIssueToDiagnostics(reviewIssue: ReviewIssue, document: vscode.TextDocument) {
  // File level issues
  if (!reviewIssue.functions) {
    const range = new vscode.Range(0, 0, 0, 0);
    const diagnostic = new vscode.Diagnostic(range, reviewIssue.category, vscode.DiagnosticSeverity.Warning);
    diagnostic.code = createDiagnosticCodeWithTarget(reviewIssue.category, range.start, document);
    return [diagnostic];
  }

  // Function level issues
  return reviewIssue.functions.map((func: IssueDetails) => {
    const category = reviewIssue.category;
    const range = fnCoordinateToRange(
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
    diagnostic.code = createDiagnosticCodeWithTarget(category, range.start, document);
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

  if (isDefined(reviewResult.score)) {
    const scoreDiagnostic = createGeneralDiagnostic(reviewResult);
    return [scoreDiagnostic, ...diagnostics];
  } else {
    return diagnostics;
  }
}

export function getCsDiagnosticCode(code?: string | number | { value: string | number; target: vscode.Uri }) {
  if (typeof code === 'string') return code;
  if (typeof code === 'object') return code.value.toString();
}

/**
 * Creates a diagnostic code with a target that opens documentation for the issue category
 * @param category
 * @returns
 */
function createDiagnosticCodeWithTarget(category: string, position: vscode.Position, document: vscode.TextDocument) {
  const args = [{ codeSmell: { category, position }, documentUri: document.uri }];
  const openDocCommandUri = vscode.Uri.parse(
    `command:codescene.openInteractiveDocsPanel?${encodeURIComponent(JSON.stringify(args))}`
  );
  return {
    value: category,
    target: openDocCommandUri,
  };
}
