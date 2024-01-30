import vscode, { Diagnostic, Uri, workspace } from 'vscode';
import { CsRestApi, RefactorResponse } from '../cs-rest-api';
import { keyStr, rangeStr } from '../utils';
import { FnToRefactor } from './command';
import { AxiosError } from 'axios';
import { logOutputChannel } from '../log';
import { CsRefactorCodeLensProvider } from './codelens';

export class CsRefactoringRequest {
  resolvedResponse?: RefactorResponse;
  error?: string;
  refactorResponse?: Promise<RefactorResponse | string>;
  fnToRefactor: FnToRefactor;
  private abortController: AbortController;

  constructor(
    csRestApi: CsRestApi,
    codeLensProvider: CsRefactorCodeLensProvider,
    diagnostic: Diagnostic,
    fnToRefactor: FnToRefactor
  ) {
    this.fnToRefactor = fnToRefactor;
    this.abortController = new AbortController();
    this.refactorResponse = csRestApi
      .fetchRefactoring(diagnostic, fnToRefactor, this.abortController.signal)
      .then((response) => {
        logOutputChannel.info(
          `Refactor response for "${fnToRefactor.name}" ${rangeStr(fnToRefactor.range)}: ${JSON.stringify(
            response.confidence
          )}`
        );
        if (!this.validConfidenceLevel(response.confidence.level)) { 
          this.error = `Invalid confidence level: ${response.confidence.level}`;
          logOutputChannel.error(
            `Refactor response error: ${this.error} for "${fnToRefactor.name}" ${rangeStr(fnToRefactor.range)}`
          );
          return this.error;
        }
        this.resolvedResponse = response;
        return response;
      })
      .catch((err: Error | AxiosError) => {
        let msg = err.message;
        if (err instanceof AxiosError) {
          msg = `[${err.code}] ${err.message}`;
        }
        logOutputChannel.error(
          `Refactor response error: ${msg} for "${fnToRefactor.name}" ${rangeStr(fnToRefactor.range)}`
        );
        this.error = msg;
        return msg;
      })
      .finally(() => {
        codeLensProvider.update();
      });
  }

  abort() {
    this.abortController.abort();
  }

  private validConfidenceLevel(level: number) {
    return level > 0 && level <= 3;
  }
}

export default class CsRefactoringRequests {
  private static map: Record<string, CsRefactoringRequest | undefined> = {};

  private static interalAbort(key: string) {
    const request = CsRefactoringRequests.map[key];
    if (request) {
      request.abort();
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
