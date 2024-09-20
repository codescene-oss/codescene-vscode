import { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter, TextDocument } from 'vscode';
import { CsRestApi } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import Telemetry from '../telemetry';
import { isDefined, rangeStr } from '../utils';
import { FnToRefactor } from './commands';
import { RefactorConfidence, RefactorResponse } from './model';
import { AceRequestEvent } from './addon';

export interface ResolvedRefactoring {
  fnToRefactor: FnToRefactor;
  document: TextDocument;
  traceId: string;
  response: RefactorResponse;
}

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
    this.promise = CsRestApi.instance
      .fetchRefactoring(this.fnToRefactor, this.traceId, this.abortController.signal)
      .then((response) => {
        this.response = response;
        return response;
      })
      .catch((error) => {
        let msg = error.message;
        if (error instanceof AxiosError) {
          msg = getErrorString(error);
        }
        throw new Error(msg);
      });
  }

  abort() {
    this.abortController.abort();
  }

  /**
   * @returns Object conforming to the ResolvedRefactoring interface if the response is
   * resolved, undefined otherwise
   */
  resolvedRefactoring(): ResolvedRefactoring | undefined {
    if (this.isPending()) return;
    return {
      ...this,
      response: this.response,
    } as ResolvedRefactoring;
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
    return validConfidenceLevel(level);
  }
}

function validConfidenceLevel(level: number) {
  return level > 0;
}

export class CsRefactoringRequests {
  private static readonly requestsChangedEmitter = new EventEmitter<AceRequestEvent>();
  static readonly onDidChangeRequests = CsRefactoringRequests.requestsChangedEmitter.event;

  private static readonly errorEmitter = new EventEmitter<Error | AxiosError>();
  static readonly onDidRequestFail = CsRefactoringRequests.errorEmitter.event;

  static initiate(document: TextDocument, fnsToRefactor: FnToRefactor[]) {
    const requests: CsRefactoringRequest[] = [];

    fnsToRefactor.forEach(async (fn) => {
      const req = new CsRefactoringRequest(fn, document);
      logOutputChannel.debug(`Refactor request for ${logIdString(req.traceId, req.fnToRefactor)}`);
      req.promise
        .then((response) => {
          logOutputChannel.debug(
            `Refactor response for ${logIdString(req.traceId, req.fnToRefactor)}: ${confidenceString(
              response.confidence
            )}`
          );
        })
        .catch((error) => {
          logOutputChannel.error(`Refactor error for ${logIdString(req.traceId, req.fnToRefactor)}: ${error.message}`);
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

function getErrorString(err: AxiosError) {
  let defaultMsg = `[${err.code}] ${err.message}`;
  if (!isDefined(err.response)) return defaultMsg;

  const data = err.response?.data as { error?: string };
  return data.error ? `[${err.code}] ${data.error}` : defaultMsg;
}

function logIdString(traceId: string, fnToRefactor: FnToRefactor) {
  return `[traceId ${traceId}] "${fnToRefactor.name}" ${rangeStr(fnToRefactor.range)}`;
}

function confidenceString(confidence: RefactorConfidence) {
  return `${confidence.description} (${confidence.level})`;
}
