import { v4 as uuidv4 } from 'uuid';
import { TextDocument } from 'vscode';
import { DevtoolsAPI, logIdString } from '../devtools-api';
import { FnToRefactor, RefactorResponse } from '../devtools-api/refactor-models';
import { logOutputChannel } from '../log';
import { ProgressCallback } from './agent-service';
import { FixGoalTarget, FixGoalOutcome } from './agent-types';

export class RefactoringRequest {
  readonly traceId: string;
  private _promise?: Promise<RefactorResponse>;
  private abortController = new AbortController();
  readonly signal = this.abortController.signal;
  onProgress?: ProgressCallback;
  goalOutcome?: FixGoalOutcome;

  constructor(readonly fnToRefactor: FnToRefactor, readonly document: TextDocument, readonly skipCache: boolean = false, readonly goal?: FixGoalTarget) {
    this.document = document;
    this.fnToRefactor = fnToRefactor;
    this.traceId = uuidv4();
  }

  get promise(): Promise<RefactorResponse> {
    if (!this._promise) {
      this._promise = DevtoolsAPI.postRefactoring(this, (message) => this.onProgress?.(message)).then((response) => {
        if (response['goal-outcome']) {
          this.goalOutcome = response['goal-outcome'];
        }
        return response;
      });
    }
    return this._promise;
  }

  get eventData() {
    const eventData: any = { traceId: this.traceId };
    if (this.skipCache) eventData.skipCache = true;
    if (this.goal) eventData.goalId = this.goal.goalId;
    if (this.goalOutcome) eventData.outcome = this.goalOutcome;
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
