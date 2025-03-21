/* eslint-disable @typescript-eslint/naming-convention */
export interface CodeHealthRulesResult {
  rulesMsg: string;
  errorMsg?: string;
}

export interface DevtoolsError {
  message: string;
  [property: string]: any;
}
