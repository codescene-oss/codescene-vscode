import { CsRefactoringRequest } from '../refactoring/cs-refactoring-requests';
import { Range } from '../review/model';
import { roundScore } from '../review/utils';

/* eslint-disable @typescript-eslint/naming-convention */
export interface DeltaForFile {
  'old-score'?: number;
  'new-score'?: number;
  'file-level-findings': ChangeDetail[];
  'function-level-findings': FunctionFinding[];
  refactorings?: CsRefactoringRequest[]; // Added for ACE
}

export function scorePresentation(delta: DeltaForFile) {
  const oldScorePresentation = delta['old-score'] ? roundScore(delta['old-score']) : 'n/a';
  const newScorePresentation = delta['new-score'] ? roundScore(delta['new-score']) : 'n/a';
  return `${oldScorePresentation} → ${newScorePresentation}`;
}

export interface FunctionFinding {
  function: FunctionInfo;
  'change-details': ChangeDetail[];
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
