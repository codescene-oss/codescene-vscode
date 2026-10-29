import { basename, extname } from 'path';
import vscode from 'vscode';
import { ChangeType, FunctionFinding } from '../devtools-api/delta-model';
import { FnToRefactor, RefactoringTarget } from '../devtools-api/refactor-models';
import { CodeSmell, Range, Review } from '../devtools-api/review-model';
import { findFunctionForCodeSmell, vscodeRange } from '../review/utils';
import { isDefined } from '../utils';

function wholeLinesRange(document: vscode.TextDocument, startLine: number, endLine: number): Range {
  const lastLine = Math.max(startLine, Math.min(endLine, document.lineCount));
  return {
    'start-line': startLine,
    'start-column': 1,
    'end-line': lastLine,
    'end-column': document.lineAt(lastLine - 1).text.length + 1,
  };
}

function buildFnToRefactor(
  document: vscode.TextDocument,
  name: string,
  range: Range,
  targets: RefactoringTarget[]
): FnToRefactor {
  const fnRange = vscodeRange(range)!;
  return {
    name,
    body: document.getText(fnRange),
    'file-type': extname(document.fileName).slice(1),
    range,
    'refactoring-targets': targets,
    vscodeRange: fnRange,
  };
}

export function fnToRefactorForCodeSmell(
  document: vscode.TextDocument,
  codeSmell: CodeSmell,
  review?: Review
): FnToRefactor {
  const target = { category: codeSmell.category, line: codeSmell['highlight-range']['start-line'] };
  const fn = review && findFunctionForCodeSmell(review, codeSmell);
  if (fn) {
    return buildFnToRefactor(document, fn.function, wholeLinesRange(document, fn.range['start-line'], fn.range['end-line']), [target]);
  }
  return buildFnToRefactor(document, basename(document.fileName), wholeLinesRange(document, 1, document.lineCount), [target]);
}

export function fnToRefactorForFinding(document: vscode.TextDocument, finding: FunctionFinding): FnToRefactor | undefined {
  const { name, range } = finding.function;
  if (!range) return;
  const targets = finding['change-details']
    .filter((detail) => detail['change-type'] !== ChangeType.Fixed && isDefined(detail.line))
    .map((detail) => ({ category: detail.category, line: detail.line! }));
  if (targets.length === 0) return;
  return buildFnToRefactor(document, name, wholeLinesRange(document, range['start-line'], range['end-line']), targets);
}
