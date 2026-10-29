import vscode from 'vscode';
import { DevtoolsAPI } from '.';
import { vscodeRange } from '../review/utils';
import { Delta } from './delta-model';

/**
 * NOTE - Mutates the delta result by adding info about refactorable functions to the 'function-level-findings' list.
 */
export async function addRefactorableFunctionsToDeltaResult(document: vscode.TextDocument, deltaForFile: Delta) {
  const functionsToRefactor = await DevtoolsAPI.fnsToRefactorFromDelta(document, deltaForFile);
  if (!functionsToRefactor) return;

  // Add a refactorableFn property to the findings that matches function name and range
  deltaForFile['function-level-findings'].forEach((finding) => {
    const findingRange = vscodeRange(finding.function.range);
    if (!findingRange) return;
    const refactorableFunctionForFinding = functionsToRefactor.find(
      (fn) => fn.name === finding.function.name && fn.vscodeRange.intersection(findingRange)
    );
    finding.refactorableFn = refactorableFunctionForFinding;
  });
}
