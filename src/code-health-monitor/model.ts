import { Range } from '../review/model';
import { formatScore } from '../review/utils';

/* eslint-disable @typescript-eslint/naming-convention */
export interface DeltaForFile {
  'old-score'?: number;
  'new-score'?: number;
  'score-change': number;
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
}

export interface ChangeDetail {
  'change-type': ChangeType;
  category: string;
  description: string;
  line?: number;
}

export interface FunctionInfo {
  name: string;
  range?: Range;
}

export type ChangeType = 'introduced' | 'fixed' | 'improved' | 'degraded' | 'unchanged';
export const sortOrder: { [key in ChangeType]: number } = {
  introduced: 1,
  degraded: 2,
  unchanged: 3,
  fixed: 5,
  improved: 4,
};

export function isDegradation(changeType: ChangeType) {
  return changeType === 'degraded' || changeType === 'introduced';
}

export function hasImprovementOpportunity(changeType: ChangeType) {
  return isDegradation(changeType) || changeType === 'improved';
}
