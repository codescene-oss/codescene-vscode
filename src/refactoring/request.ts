import { v4 as uuidv4 } from 'uuid';
import { TextDocument } from 'vscode';
import { DevtoolsAPI, logIdString } from '../devtools-api';
import { FnToRefactor, RefactorResponse } from '../devtools-api/refactor-models';
import { logOutputChannel } from '../log';
import { ProgressCallback } from './agent-service';

export class RefactoringRequest {
  readonly traceId: string;
  promise: Promise<RefactorResponse>;
  private abortController = new AbortController();
  readonly signal = this.abortController.signal;
  onProgress?: ProgressCallback;

  constructor(readonly fnToRefactor: FnToRefactor, readonly document: TextDocument, readonly skipCache: boolean = false) {
    this.document = document;
    this.fnToRefactor = fnToRefactor;
    this.traceId = uuidv4();
    this.promise = DevtoolsAPI.postRefactoring(this, (message) => this.onProgress?.(message));
  }

  get eventData() {
    const eventData: any = { traceId: this.traceId };
    if (this.skipCache) eventData.skipCache = true;
    return eventData;
  }

  abort() {
    this.abortController.abort();

    logOutputChannel.info(
      `Refactor request aborted ${logIdString(this.fnToRefactor, this.traceId)}${
        this.skipCache === true ? ' (retry)' : ''
      }`
    );
  }
}
