import { v4 as uuidv4 } from 'uuid';
import { TextDocument } from 'vscode';
import { DevtoolsAPI, logIdString } from '../devtools-api';
import { FnToRefactor, RefactorResponse } from '../devtools-api/refactor-models';
import { logOutputChannel } from '../log';
import { ProgressCallback } from './agent-service';
import { FixGoalTarget, FixGoalOutcome } from './agent-types';
import { AbortError } from '../devtools-api/abort-error';
import { logAiStage, failureReason } from './ai-telemetry';

export class RefactoringRequest {
  readonly traceId: string;
  private _promise?: Promise<RefactorResponse>;
  private abortController = new AbortController();
  readonly signal = this.abortController.signal;
  onProgress?: ProgressCallback;
  goalOutcome?: FixGoalOutcome;
  source?: string;
  private presented = false;
  private noSuggestion = false;

  constructor(readonly fnToRefactor: FnToRefactor, readonly document: TextDocument, readonly skipCache: boolean = false, readonly goal?: FixGoalTarget) {
    this.document = document;
    this.fnToRefactor = fnToRefactor;
    this.traceId = uuidv4();
  }

  isNoSuggestion(response: RefactorResponse): boolean {
    return response['goal-outcome'] === 'unable' || response.code === this.fnToRefactor.body;
  }

  markPresented(): boolean {
    if (this.presented || this.noSuggestion) return false;
    this.presented = true;
    return true;
  }

  get promise(): Promise<RefactorResponse> {
    if (!this._promise) {
      logAiStage(this, 'agent-invoked');

      this._promise = DevtoolsAPI.postRefactoring(this, (message) => this.onProgress?.(message)).then(
        (response) => {
          if (response['goal-outcome']) {
            this.goalOutcome = response['goal-outcome'];
          }

          this.noSuggestion = this.isNoSuggestion(response);
          logAiStage(this, this.noSuggestion ? 'no-suggestion' : 'suggestion-produced');

          return response;
        },
        (e) => {
          if (e instanceof AbortError) {
            logAiStage(this, 'cancelled');
          } else {
            logAiStage(this, 'failed', { reason: failureReason(e) });
          }
          throw e;
        }
      );
    }
    return this._promise;
  }

  get eventData() {
    const eventData: any = { traceId: this.traceId };
    if (this.skipCache) eventData.skipCache = true;
    if (this.source) eventData.source = this.source;
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
