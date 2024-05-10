/* eslint-disable @typescript-eslint/naming-convention */
export interface DeltaForFile {
  name: string;
  findings: Finding[];
  'old-score': number | null;
  'new-score': number;
}

export interface Finding {
  category: string;
  'change-type': ChangeType;
  'new-pp': number;
  'change-details': ChangeDetails[];
  threshold: number;
}

export interface ChangeDetails {
  'change-type': ChangeType;
  description: string;
  value: number;
  locations?: Location[];
}

export interface Location {
  'start-line'?: number;
  'end-line'?: number;
  'start-line-before'?: number;
  'end-line-before'?: number;
  function: string;
}

export type ChangeType = 'introduced' | 'fixed' | 'improved' | 'degraded' | 'unchanged';

export function isImprovement(changeType: ChangeType) {
  return changeType === 'improved' || changeType === 'fixed';
}
export function isDegradation(changeType: ChangeType) {
  return changeType === 'degraded' || changeType === 'introduced';
}