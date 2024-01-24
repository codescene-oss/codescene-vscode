import vscode from 'vscode';
import { RefactorResponse } from '../cs-rest-api';
import { keyStr } from '../utils';
import { FnToRefactor } from './command';
import { AxiosError } from 'axios';

export interface CsRefactoringRequest {
  fnToRefactor: FnToRefactor;
  refactorResponse: Promise<RefactorResponse | string>;
}

export default class CsRefactoringRequests {
  private static map: Record<string, CsRefactoringRequest | undefined> = {};

  static clearAll() {
    CsRefactoringRequests.map = {};
  }

  static add(diagnostic: vscode.Diagnostic, request?: CsRefactoringRequest) {
    const key = keyStr(diagnostic);
    CsRefactoringRequests.map[key] = request;
  }

  static get(diagnostic: vscode.Diagnostic) {
    const key = keyStr(diagnostic);
    return CsRefactoringRequests.map[key];
  }
}
