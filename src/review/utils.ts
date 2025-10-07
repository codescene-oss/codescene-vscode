import * as vscode from 'vscode';
import { CodeSmell, Function, Range, Review } from '../devtools-api/review-model';
import { CsDiagnostic, csSource } from '../diagnostics/cs-diagnostics';
import { isDefined } from '../utils';

const noApplicationCode = 'No application code detected for scoring';

export function reviewFunctionToDiagnostics(reviewFunction: Function, document: vscode.TextDocument) {
  return reviewFunction['code-smells'].map((cs) => reviewCodeSmellToDiagnostics(cs, document)).filter(isDefined);
}

export function vscodeRange(modelRange?: Range) {
  if (!modelRange) return;
  return new vscode.Range(
    modelRange['start-line'] - 1,
    modelRange['start-column'] - 1,
    modelRange['end-line'] - 1,
    modelRange['end-column'] - 1
  );
}

export function reviewCodeSmellToDiagnostics(codeSmell: CodeSmell, document: vscode.TextDocument) {
  const category = codeSmell.category;
  const range = vscodeRange(codeSmell['highlight-range'])!;
  if (!range) return;

  let message;
  if (codeSmell.details) {
    message = addDetails(category, codeSmell.details);
  } else {
    message = category;
  }
  const diagnostic = new CsDiagnostic(range, message, vscode.DiagnosticSeverity.Warning, codeSmell);
  diagnostic.source = csSource;
  diagnostic.code = createDiagnosticCodeWithTarget(category, range.start, document);
  return diagnostic;
}

export function formatScore(score?: number): string {
  return score ? `${score}/10` : noApplicationCode;
}

const detailSeparator = ' (';
function addDetails(category: string, details: string) {
  return `${category}${detailSeparator}${details})`;
}

export function removeDetails(diagnosticMessage: string) {
  const ix = diagnosticMessage.indexOf(detailSeparator);
  if (ix > 0) {
    return diagnosticMessage.substring(0, ix);
  }
  return diagnosticMessage;
}

export function reviewResultToDiagnostics(reviewResult: Review, document: vscode.TextDocument) {
  let diagnostics: CsDiagnostic[] = [];
  for (const fun of reviewResult['function-level-code-smells'] || []) {
    diagnostics.push(...reviewFunctionToDiagnostics(fun, document));
  }

  const fileLevelDiagnostics = (reviewResult['file-level-code-smells'] || [])
    .map((cs) => reviewCodeSmellToDiagnostics(cs, document))
    .filter(isDefined);
  diagnostics.push(...fileLevelDiagnostics);

  return diagnostics;
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
  const args = [{ category, lineNo: position.line, charNo: position.character, documentUri: document.uri }];
  const openDocCommandUri = vscode.Uri.parse(
    `command:codescene.openInteractiveDocsFromDiagnosticTarget?${encodeURIComponent(JSON.stringify(args))}`
  );
  return {
    value: category,
    target: openDocCommandUri,
  };
}
