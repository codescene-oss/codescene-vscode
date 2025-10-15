import { v4 as uuidv4 } from 'uuid';
import { TextDocument } from 'vscode';
import { DevtoolsAPI } from '../devtools-api';
import { FnToRefactor, RefactorResponse } from '../devtools-api/refactor-models';

export class RefactoringRequest {
  readonly traceId: string;
  promise: Promise<RefactorResponse>;
  private abortController = new AbortController();
  readonly signal = this.abortController.signal;

  constructor(readonly fnToRefactor: FnToRefactor, readonly document: TextDocument, readonly skipCache = false) {
    this.document = document;
    this.fnToRefactor = fnToRefactor;
    this.traceId = uuidv4();
    this.promise = DevtoolsAPI.postRefactoring(this);
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
