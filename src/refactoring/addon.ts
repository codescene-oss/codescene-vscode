// Functions for handling enabling and disabling the ACE "addon" components
import { AxiosError } from 'axios';
import vscode from 'vscode';
import { AceFeature } from '../cs-extension-state';
import { DevtoolsAPI } from '../devtools-interop/api';
import { RefactoringRequest } from './request';

/**
 * Work in progress API just to keep us from creating too many contact points between
 * the ACE functionality and the rest of the extension
 */
export interface AceAPI {
  onDidChangeState: vscode.Event<AceFeature>;
  onDidRefactoringRequest: vscode.Event<AceRequestEvent>;
  onDidRequestFail: vscode.Event<Error | AxiosError>;
}

export type AceRequestEvent = {
  document: vscode.TextDocument;
  type: 'start' | 'end';
  request: RefactoringRequest;
};

/**
 * Aside from the AceAPI, this "addon" also contributes
 * the codescene.ace.activate command
 */
export function activate(context: vscode.ExtensionContext, devtoolsApi: DevtoolsAPI): AceAPI {
  return {
    onDidChangeState: stateEmitter.event,
    onDidRefactoringRequest: RefactoringRequest.onDidRefactoringRequest,
    onDidRequestFail: RefactoringRequest.onDidRequestFail,
  };
}

const stateEmitter = new vscode.EventEmitter<AceFeature>();
