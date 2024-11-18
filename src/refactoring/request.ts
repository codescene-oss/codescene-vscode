import { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter, TextDocument } from 'vscode';
import { AceRequestEvent } from './addon';
import { RefactoringAPI } from './api';
import { FnToRefactor } from './capabilities';
import { RefactorResponse } from './model';

export class RefactoringRequest {
  private static readonly refactoringRequestEmitter = new EventEmitter<AceRequestEvent>();
  static readonly onDidRefactoringRequest = RefactoringRequest.refactoringRequestEmitter.event;

  private static readonly errorEmitter = new EventEmitter<Error | AxiosError>();
  static readonly onDidRequestFail = RefactoringRequest.errorEmitter.event;

  readonly traceId: string;
  promise: Promise<RefactorResponse>;
  private abortController: AbortController;

  constructor(readonly fnToRefactor: FnToRefactor, readonly document: TextDocument, skipCache = false) {
    this.document = document;
    this.fnToRefactor = fnToRefactor;
    this.traceId = uuidv4();
    this.abortController = new AbortController();
    this.promise = this.initiate(skipCache);
  }

  private initiate(skipCache: boolean) {
    this.promise = RefactoringAPI.instance
      .fetchRefactoring(this.fnToRefactor, this.traceId, this.abortController.signal, skipCache)
      .then((response) => {
        return response;
      })
      .catch((error) => {
        RefactoringRequest.errorEmitter.fire(error);
        throw error;
      })
      .finally(() => {
        // Fire updates for all finished requests
        RefactoringRequest.refactoringRequestEmitter.fire({ document: this.document, type: 'end', request: this });
      });
    RefactoringRequest.refactoringRequestEmitter.fire({ document: this.document, type: 'start', request: this });
    return this.promise;
  }

  abort() {
    this.abortController.abort();
  }
}
