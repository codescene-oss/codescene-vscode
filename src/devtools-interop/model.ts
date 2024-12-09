
/* eslint-disable @typescript-eslint/naming-convention */

export interface EnclosingFn {
  name: string;
  'start-line': number;
  'end-line': number;
  body: string;
  'function-type': string;
  'start-column': number;
  'end-column': number;
  'active-code-size': number;
}

export interface CodeHealthRulesResult {
  rulesMsg: string;
  errorMsg?: string;
}