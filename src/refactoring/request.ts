import { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter, TextDocument } from 'vscode';
import { DevtoolsAPI } from '../devtools-interop/api';
import { AceRequestEvent } from './addon';
import { FnToRefactor } from './capabilities';
import { RefactorResponse } from './model';

export class RefactoringRequest {
  private static readonly refactoringRequestEmitter = new EventEmitter<AceRequestEvent>();
  static readonly onDidRefactoringRequest = RefactoringRequest.refactoringRequestEmitter.event;

  private static readonly errorEmitter = new EventEmitter<Error | AxiosError>();
  static readonly onDidRequestFail = RefactoringRequest.errorEmitter.event;

  readonly traceId: string;
  promise: Promise<RefactorResponse>;
  private abortController = new AbortController();
  readonly signal = this.abortController.signal;

  constructor(
    readonly fnToRefactor: FnToRefactor,
    readonly document: TextDocument,
    readonly devtoolsApi: DevtoolsAPI,
    readonly skipCache = false
  ) {
    this.document = document;
    this.fnToRefactor = fnToRefactor;
    this.traceId = uuidv4();
    this.promise = this.initiate();
  }

  private initiate() {
    this.promise = this.devtoolsApi
      .post(this)
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

  get eventData() {
    const eventData: any = { traceId: this.traceId };
    if (this.skipCache) eventData.skipCache = true;
    return eventData;
  }

  abort() {
    this.abortController.abort();
  }
}
