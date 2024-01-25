import { Diagnostic } from 'vscode';
import { RefactorResponse } from '../cs-rest-api';
import { keyStr } from '../utils';
import { FnToRefactor } from './command';

export interface CsRefactoringRequest {
  fnToRefactor: FnToRefactor;
  abortController: AbortController;
  refactorResponse: Promise<RefactorResponse | string>;
}

export default class CsRefactoringRequests {
  private static map: Record<string, CsRefactoringRequest | undefined> = {};

  private static interalAbort(key: string) {
    const request = CsRefactoringRequests.map[key];
    if (request) {
      request.abortController.abort();
    }
  }

  static clearAll() {
    for (const key in CsRefactoringRequests.map) {
      CsRefactoringRequests.interalAbort(key);
    }
    CsRefactoringRequests.map = {};
  }

  static abort(diagnostic: Diagnostic) {
    const key = keyStr(diagnostic);
    CsRefactoringRequests.interalAbort(key);
  }

  static add(diagnostic: Diagnostic, request?: CsRefactoringRequest) {
    const key = keyStr(diagnostic);
    CsRefactoringRequests.map[key] = request;
  }

  static get(diagnostic: Diagnostic) {
    const key = keyStr(diagnostic);
    return CsRefactoringRequests.map[key];
  }
}
