import vscode from 'vscode';
import { DevtoolsAPI } from '.';
import { vscodeRange } from '../review/utils';
import { isDefined } from '../utils';
import { Delta } from './delta-model';

/**
 * Creates a valid input string for the delta command.
 * Will return undefined if the old and new score are the same. Used to avoid invoking
 * the delta command.
 *
 * @param oldScore raw base64 encoded score
 * @param newScore raw base64 encoded score
 * @returns
 */
export function jsonForScores(oldScore?: string | void, newScore?: string | void) {
  if (oldScore === newScore) return; // No need to run the delta command if the scores are the same

  const scoreObject = {};
  if (isDefined(oldScore)) {
    Object.assign(scoreObject, { 'old-score': oldScore });
  }
  if (isDefined(newScore)) {
    Object.assign(scoreObject, { 'new-score': newScore });
  }

  if (Object.keys(scoreObject).length === 0) return; // if both are undefined the delta command will fail

  return JSON.stringify(scoreObject);
}

/**
 * NOTE - Mutates the delta result by adding info about refactorable functions to the 'function-level-findings' list.
 */
// CS-5069 Remove ACE from public version
// export async function addRefactorableFunctionsToDeltaResult(document: vscode.TextDocument, deltaForFile: Delta) {
//   const functionsToRefactor = await DevtoolsAPI.fnsToRefactorFromDelta(document, deltaForFile);
//   if (!functionsToRefactor) return;

//   // Add a refactorableFn property to the findings that matches function name and range
//   deltaForFile['function-level-findings'].forEach((finding) => {
//     const findingRange = vscodeRange(finding.function.range);
//     if (!findingRange) return;
//     const refactorableFunctionForFinding = functionsToRefactor.find(
//       (fn) => fn.name === finding.function.name && fn.vscodeRange.intersection(findingRange)
//     );
//     finding.refactorableFn = refactorableFunctionForFinding;
//   });
// }
