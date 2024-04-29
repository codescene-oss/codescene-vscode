/* eslint-disable @typescript-eslint/naming-convention */
export interface DeltaForFile {
  name: string;
  findings: Finding[];
  'old-score': number;
  'new-score': number;
}

interface Finding {
  category: string;
  'change-type': string;
  'new-pp': number;
  'change-details': ChangeDetails[];
  threshold: number;
}

interface ChangeDetails {
  'change-type': string;
  description: string;
  value: number;
  locations: Location[];
}

interface Location {
  'start-line': number;
  'end-line': number;
  function: string;
}
