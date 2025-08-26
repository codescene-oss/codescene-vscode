import vscode from 'vscode';
// CS-5069 Remove ACE from public version
// import { RefactoringRequest } from '../refactoring/request';

/* eslint-disable @typescript-eslint/naming-convention */
export interface CodeHealthRulesResult {
  rulesMsg: string;
  errorMsg?: string;
}

export interface DevtoolsError {
  message: string;
  [property: string]: any;
}

export type AceRequestEvent = {
  document: vscode.TextDocument;
  type: 'start' | 'end';
  // CS-5069 Remove ACE from public version
  // request: RefactoringRequest;
};
