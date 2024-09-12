import * as vscode from 'vscode';
import { csSource } from '../diagnostics/cs-diagnostics';
import { fnCoordinateToRange } from '../diagnostics/utils';
import { isDefined } from '../utils';
import { ReviewFunction, ReviewResult, CodeSmell } from './model';

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

export function reviewFunctionToDiagnostics(reviewFunction: ReviewFunction, document: vscode.TextDocument) {
    let diagnostics: vscode.Diagnostic[] = [];
    for (const codeSmell of reviewFunction['code-smells']) {
        const diagnostic = reviewCodeSmellToDiagnostics(codeSmell, document);
        diagnostics.push(diagnostic);
    }
    return diagnostics;
}

export function reviewCodeSmellToDiagnostics(codeSmell: CodeSmell, document: vscode.TextDocument) {
  const category = codeSmell.category;
  const codeSmellRange = codeSmell.range;
  const range = new vscode.Range(codeSmellRange['start-line']-1, codeSmellRange['start-column']-1, codeSmellRange['end-line']-1, codeSmellRange['end-column']-1);
  
  let message;
  if (codeSmell.details) {
    message = `${category} (${codeSmell.details})`;
  } else {
    message = category;
  }
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
  diagnostic.source = csSource;
  diagnostic.code = createDiagnosticCodeWithTarget(category, range.start, document); 
  return diagnostic; 
}

export function roundScore(score: number): number {
  return +score.toFixed(2);
}
export function formatScore(score: number | void): string {
  return score ? `${roundScore(score)}/10` : 'n/a';
}

export function reviewResultToDiagnostics(reviewResult: ReviewResult, document: vscode.TextDocument) {
  let diagnostics: vscode.Diagnostic[] = [];
  for(const fun of reviewResult['function-level-code-smells']) {
    diagnostics.push(...reviewFunctionToDiagnostics(fun, document));
  }

  for(const codeSmell of reviewResult['expression-level-code-smells']) {
    diagnostics.push(reviewCodeSmellToDiagnostics(codeSmell, document));
  }
  
  for(const codeSmell of reviewResult['file-level-code-smells']) {
    diagnostics.push(reviewCodeSmellToDiagnostics(codeSmell, document));
  }

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
