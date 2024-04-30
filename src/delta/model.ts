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

interface ChangeDetails {
  'change-type': ChangeType;
  description: string;
  value: number;
  locations?: Location[];
}

interface Location {
  'start-line': number;
  'end-line': number;
  function: string;
}

type ChangeType = 'introduced' | 'fixed' | 'improved' | 'degraded' | 'unchanged';
