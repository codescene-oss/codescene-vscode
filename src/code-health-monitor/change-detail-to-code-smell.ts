import { ChangeDetail, ChangeType } from '../devtools-api/delta-model';
import { CodeSmell, Range } from '../devtools-api/review-model';
import { logOutputChannel } from '../log';

/**
 * Change types that are eligible for refactoring.
 * - 'introduced': New code smell that didn't exist before
 * - 'degraded': Existing smell that got worse
 */
const REFACTORABLE_CHANGE_TYPES: ChangeType[] = [ChangeType.Introduced, ChangeType.Degraded];

/**
 * Determines if a ChangeDetail is eligible for refactoring.
 */
export function isRefactorableChangeDetail(changeDetail: ChangeDetail): boolean {
  const isRefactorable = REFACTORABLE_CHANGE_TYPES.includes(changeDetail['change-type']);
  return isRefactorable;
}

/**
 * Converts a ChangeDetail to a CodeSmell format.
 *
 * Since ChangeDetail has less precise location info than CodeSmell,
 * we construct the highlight-range as follows:
 * - If ChangeDetail has a line number, use it for start-line
 * - Otherwise, fall back to the function's range start-line
 * - The range spans a single line (start = end) since we don't have column info
 *
 * @param changeDetail - The change detail from Delta API
 * @param functionRange - The function's range to use as fallback
 * @returns CodeSmell object suitable for refactoring, or undefined if not refactorable
 */
export function changeDetailToCodeSmell(
  changeDetail: ChangeDetail,
  functionRange?: { 'start-line': number; 'start-column': number; 'end-line': number; 'end-column': number }
): CodeSmell | undefined {
  if (!isRefactorableChangeDetail(changeDetail)) {
    return undefined;
  }

  // Determine the line number:
  // 1. Prefer ChangeDetail.line if available (1-indexed)
  // 2. Fall back to function's start line
  // 3. Default to line 1 if nothing available
  const line = changeDetail.line ?? functionRange?.['start-line'] ?? 1;

  // Construct highlight-range (single line since we don't have column info)
  // Use column 1 for start, and a large column for end to highlight the whole line
  const highlightRange: Range = {
    'start-line': line,
    'start-column': 1,
    'end-line': line,
    'end-column': 1000, // Effectively "end of line"
  };

  return {
    category: changeDetail.category,
    details: changeDetail.description,
    'highlight-range': highlightRange,
  };
}

/**
 * Finds the first refactorable ChangeDetail from a list and converts it to CodeSmell.
 *
 * @param changeDetails - List of change details to check
 * @param functionRange - The function's range for fallback positioning
 * @returns The first refactorable CodeSmell, or undefined if none found
 */
export function findFirstRefactorableCodeSmell(
  changeDetails: ChangeDetail[],
  functionRange?: { 'start-line': number; 'start-column': number; 'end-line': number; 'end-column': number }
): CodeSmell | undefined {
  for (const detail of changeDetails) {
    const codeSmell = changeDetailToCodeSmell(detail, functionRange);
    if (codeSmell) {
      return codeSmell;
    }
  }
  return undefined;
}
