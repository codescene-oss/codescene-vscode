import { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter, TextDocument } from 'vscode';
import Telemetry from '../telemetry';
import { isDefined } from '../utils';
import { AceRequestEvent } from './addon';
import { RefactoringAPI } from './api';
import { FnToRefactor } from './capabilities';
import { RefactorResponse } from './model';

export class CsRefactoringRequest {
  fnToRefactor: FnToRefactor;
  document: TextDocument;
  traceId: string;
  response?: RefactorResponse;
  promise: Promise<RefactorResponse>;
  private abortController: AbortController;

  constructor(fnToRefactor: FnToRefactor, document: TextDocument) {
    this.fnToRefactor = fnToRefactor;
    this.document = document;
    this.traceId = uuidv4();
    this.abortController = new AbortController();
    Telemetry.instance.logUsage('refactor/requested', { 'trace-id': this.traceId });
    this.promise = RefactoringAPI.instance
      .fetchRefactoring(this.fnToRefactor, this.traceId, this.abortController.signal)
      .then((response) => {
        this.response = response;
        return response;
      });
  }

  abort() {
    this.abortController.abort();
  }

  shouldPresent() {
    return this.isPending() || this.validConfidenceLevel();
  }

  actionable() {
    return this.validConfidenceLevel();
  }

  isPending() {
    return !isDefined(this.response);
  }

  validConfidenceLevel() {
    const level = this.response?.confidence.level;
    if (!isDefined(level)) return false;
    return level > 0;
  }
}

export class CsRefactoringRequests {
  private static readonly requestsChangedEmitter = new EventEmitter<AceRequestEvent>();
  static readonly onDidChangeRequests = CsRefactoringRequests.requestsChangedEmitter.event;

  private static readonly errorEmitter = new EventEmitter<Error | AxiosError>();
  static readonly onDidRequestFail = CsRefactoringRequests.errorEmitter.event;

  static initiate(document: TextDocument, fnsToRefactor: FnToRefactor[]) {
    const requests: CsRefactoringRequest[] = [];

    fnsToRefactor.forEach((fn) => {
      const req = new CsRefactoringRequest(fn, document);
      req.promise
        .catch((error) => {
          CsRefactoringRequests.errorEmitter.fire(error);
        })
        .finally(() => {
          CsRefactoringRequests.requestsChangedEmitter.fire({ document, type: 'end', request: req }); // Fire updates for all finished requests
        });
      requests.push(req);
    });

    if (requests.length > 0) {
      CsRefactoringRequests.requestsChangedEmitter.fire({ document, type: 'start', requests });
    }
    return requests;
  }
}
