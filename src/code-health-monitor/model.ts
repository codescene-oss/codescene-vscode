import { FnToRefactor } from '../refactoring/capabilities';
import { Range } from '../review/model';
import { formatScore } from '../review/utils';

/* eslint-disable @typescript-eslint/naming-convention */
export interface DeltaForFile {
  'old-score'?: number;
  'new-score'?: number;
  'file-level-findings': ChangeDetail[];
  'function-level-findings': FunctionFinding[];
}

export function scorePresentation(delta: DeltaForFile) {
  if (delta['old-score'] === delta['new-score']) return formatScore(delta['old-score']);
  const oldScorePresentation = delta['old-score'] || 'n/a';
  const newScorePresentation = delta['new-score'] || 'n/a';
  return `${oldScorePresentation} → ${newScorePresentation}`;
}

export interface FunctionFinding {
  function: FunctionInfo;
  'change-details': ChangeDetail[];

  /* Present if the function finding is deemed refactorable. See Analyser.addRefactorableFunctionsToDeltaResult() */
  refactorableFn?: FnToRefactor;
}

export interface ChangeDetail {
  'change-type': ChangeType;
  category: string;
  description: string;
  position: Position;
}

export interface Position {
  line: number;
  column: number;
}

export interface FunctionInfo {
  name: string;
  range: Range;
}

export type ChangeType = 'introduced' | 'fixed' | 'improved' | 'degraded' | 'unchanged';

export function isImprovement(changeType: ChangeType) {
  return changeType === 'improved' || changeType === 'fixed';
}
export function isDegradation(changeType: ChangeType) {
  return changeType === 'degraded' || changeType === 'introduced';
}
