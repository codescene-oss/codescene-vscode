import { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Diagnostic } from 'vscode';
import { CsRestApi, RefactorConfidence, RefactorResponse } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import { keyStr, rangeStr } from '../utils';
import { CsRefactorCodeLensProvider } from './codelens';
import { FnToRefactor } from './command';

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
    const traceId = uuidv4();
    logOutputChannel.info(`Refactor request for ${this.logIdString(traceId, fnToRefactor)}`);
    this.refactorResponse = csRestApi
      .fetchRefactoring(diagnostic, fnToRefactor, traceId, this.abortController.signal)
      .then((response) => {
        logOutputChannel.info(
          `Refactor response for ${this.logIdString(traceId, fnToRefactor)}: ${this.confidenceString(response.confidence)}`
        );
        if (!this.validConfidenceLevel(response.confidence.level)) {
          this.error = `Invalid confidence level: ${this.confidenceString(response.confidence)}`;
          logOutputChannel.error(`Refactor response error for ${this.logIdString(traceId, fnToRefactor)}: ${this.error}`);
          return this.error;
        }
        this.resolvedResponse = response;
        return response;
      })
      .catch((err: Error | AxiosError) => {
        this.error = err.message;
        if (err instanceof AxiosError) {
          this.error = `[${err.code}] ${err.message}`;
        }
        logOutputChannel.error(`Refactor response error for ${this.logIdString(traceId, fnToRefactor)}: ${this.error}`);
        return this.error;
      })
      .finally(() => {
        codeLensProvider.update();
      });
  }

  abort() {
    this.abortController.abort();
  }

  private logIdString(traceId: string, fnToRefactor: FnToRefactor) {
    return `[traceId ${traceId}] "${fnToRefactor.name}" ${rangeStr(fnToRefactor.range)}`;
  }

  private confidenceString(confidence: RefactorConfidence) {
    return `${confidence.description} (${confidence.level})`;
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
