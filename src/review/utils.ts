import * as vscode from 'vscode';
import { CodeSmell, Function, Range, Review } from '../devtools-api/review-model';
import { CsDiagnostic } from '../diagnostics/cs-diagnostic';
import { csSource } from '../diagnostics/cs-diagnostics';
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
  diagnostic.code = createDiagnosticCodeWithTarget(category, range.start, document, codeSmell);
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

/**
 * Finds the Function object that contains the given CodeSmell in a Review result.
 * Returns undefined if the code smell is not part of a function-level code smell.
 */
export function findFunctionForCodeSmell(reviewResult: Review, codeSmell: CodeSmell): Function | undefined {
  for (const fun of reviewResult['function-level-code-smells'] || []) {
    // Check if this function's code-smells array contains the given codeSmell
    // We compare by category and highlight-range to identify the match
    const matchingCodeSmell = fun['code-smells'].find(
      (cs) =>
        cs.category === codeSmell.category &&
        cs['highlight-range']['start-line'] === codeSmell['highlight-range']['start-line'] &&
        cs['highlight-range']['start-column'] === codeSmell['highlight-range']['start-column'] &&
        cs['highlight-range']['end-line'] === codeSmell['highlight-range']['end-line'] &&
        cs['highlight-range']['end-column'] === codeSmell['highlight-range']['end-column']
    );
    if (matchingCodeSmell) {
      return fun;
    }
  }
  return undefined;
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
function createDiagnosticCodeWithTarget(
  category: string,
  position: vscode.Position,
  document: vscode.TextDocument,
  codeSmell: CodeSmell
) {
  const args = [{ category, lineNo: position.line, charNo: position.character, documentUri: document.uri, codeSmell }];
  const openDocCommandUri = vscode.Uri.parse(
    `command:codescene.openInteractiveDocsFromDiagnosticTarget?${encodeURIComponent(JSON.stringify(args))}`
  );
  return {
    value: category,
    target: openDocCommandUri,
  };
}
