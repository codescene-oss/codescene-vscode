import vscode from 'vscode';

/* eslint-disable @typescript-eslint/naming-convention */

export interface CheckRulesResponse {
  result: string;
  failed: boolean;
  'parsing-errors': any[];
}

export interface CodeHealthRulesTemplateResponse {
  template: string;
}

export interface CodeHealthRulesResult {
  rulesMsg?: string;
  errorMsg?: string;
}

export interface DevtoolsError {
  message: string;
  [property: string]: any;
}

