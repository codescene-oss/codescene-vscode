
/* eslint-disable @typescript-eslint/naming-convention */

// TODO - delete
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

export interface DevtoolsError {
  message: string;
  [property: string]: any;
}

export interface CreditsInfoError {
  "credits-info": CreditsInfo;
  message: string;
  [property: string]: any;
}

export interface CreditsInfo {
  limit: number;
  /**
   * Credit reset date in ISO-8601 format
   */
  reset?: string;
  used:   number;
  [property: string]: any;
}
