import { sortOrder } from '../devtools-api/delta-model';
import { DeltaFunctionInfo } from './delta-function-info';
import { DeltaIssue } from './delta-issue';

/**
 * Sort function level issues by refactorability, then by line number.
 */
export function sortFnInfo(a: DeltaFunctionInfo, b: DeltaFunctionInfo) {
  // If one of the items has an undefined range, sort it last (functions with fixed issues might have null range)
  if (!a.range) return 1;
  if (!b.range) return -1;

  // Refactorability first
  const aRef = a.isRefactoringSupported ? -1 : 1;
  const bRef = b.isRefactoringSupported ? -1 : 1;
  if (aRef !== bRef) return aRef - bRef;

  // Then by child change detail status.
  const aChangeDetailsStatus = avgChangeDetailOrder(a);
  const bChangeDetailsStatus = avgChangeDetailOrder(b);
  if (aChangeDetailsStatus !== bChangeDetailsStatus) return aChangeDetailsStatus - bChangeDetailsStatus;

  // ...then by line number
  return a.range.start.line - b.range.start.line;
}

function avgChangeDetailOrder(fnInfo: DeltaFunctionInfo) {
  if (fnInfo.children.length === 0) return 0;
  const sortOrderSum = fnInfo.children.reduce((prev, curr) => prev + sortOrder[curr.changeDetail['change-type']], 0);
  return sortOrderSum / fnInfo.children.length;
}

export function sortIssues(a: DeltaIssue, b: DeltaIssue) {
  return sortOrder[a.changeDetail['change-type']] - sortOrder[b.changeDetail['change-type']];
}
