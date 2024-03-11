import { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Diagnostic, EventEmitter, Range, TextDocument } from 'vscode';
import { CsRestApi, RefactorConfidence, RefactorResponse } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import Telemetry from '../telemetry';
import { isDefined, rangeStr } from '../utils';
import { FnToRefactor } from './commands';

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
  promise?: Promise<RefactorResponse>;
  private abortController: AbortController;

  constructor(fnToRefactor: FnToRefactor, document: TextDocument) {
    this.fnToRefactor = fnToRefactor;
    this.document = document;
    this.traceId = uuidv4();
    this.abortController = new AbortController();
  }

  post(csRestApi: CsRestApi, diagnostics: Diagnostic[]) {
    this.promise = csRestApi
      .fetchRefactoring(diagnostics, this.fnToRefactor, this.traceId, this.abortController.signal)
      .then((response) => {
        this.response = response;
        return response;
      });
    return this.promise;
  }

  abort() {
    this.abortController.abort();
  }

  /**
   * @returns Object conforming to the ResolvedRefactoring interface if the response is
   * resolved, undefined otherwise
   */
  resolvedResponse(): ResolvedRefactoring | undefined {
    if (!isDefined(this.response)) return;
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

export function validConfidenceLevel(level: number) {
  return level > 0 && level <= 3;
}

/**
 * Map of diagnostics to refactoring requests - per document.
 * Used to get the proper requests when presenting the refactoring codelenses and codeactions.
 */
export class CsRefactoringRequests {
  private static readonly map: Map<string, Map<string, CsRefactoringRequest>> = new Map();

  private static readonly requestsChangedEmitter = new EventEmitter<void>();
  static readonly onDidChangeRequests = CsRefactoringRequests.requestsChangedEmitter.event;

  private static readonly errorEmitter = new EventEmitter<Error | AxiosError>();
  static readonly onDidRequestFail = CsRefactoringRequests.errorEmitter.event;

  static initiate(
    context: { csRestApi: CsRestApi; document: TextDocument },
    fnsToRefactor: FnToRefactor[],
    diagnostics: Diagnostic[]
  ) {
    fnsToRefactor.forEach(async (fn) => {
      const diagnosticsForFn = diagnostics.filter((d) => fn.range.contains(d.range));
      const req = new CsRefactoringRequest(fn, context.document);
      Telemetry.instance.logUsage('refactor/requested', { 'trace-id': req.traceId });
      logOutputChannel.debug(`Refactor request for ${logIdString(req.traceId, req.fnToRefactor)}`);

      // Put the request for each diagnostic in a map for access in codelens and codeaction providers
      diagnosticsForFn.forEach((d) => {
        CsRefactoringRequests.set(context.document, d, req);
      });

      req
        .post(context.csRestApi, diagnosticsForFn)
        .then((response) => {
          logOutputChannel.debug(
            `Refactor response for ${logIdString(req.traceId, req.fnToRefactor)}: ${confidenceString(
              response.confidence
            )}`
          );
        })
        .catch((error) => {
          let msg = error.message;
          if (error instanceof AxiosError) {
            msg = getErrorString(error);
          }
          logOutputChannel.error(`Refactor error for ${logIdString(req.traceId, req.fnToRefactor)}: ${msg}`);
          CsRefactoringRequests.deleteByFnRange(req.document, req.fnToRefactor.range);
          CsRefactoringRequests.errorEmitter.fire(error);
        })
        .finally(() => {
          CsRefactoringRequests.requestsChangedEmitter.fire(); // Fire updates for all finished requests
        });
    });
    CsRefactoringRequests.requestsChangedEmitter.fire();
  }

  private static set(document: TextDocument, diagnostic: Diagnostic, request: CsRefactoringRequest) {
    const uriString = document.uri.toString();
    let map = CsRefactoringRequests.map.get(uriString);
    if (!map) {
      map = new Map();
      CsRefactoringRequests.map.set(uriString, map);
    }
    map.set(diagKey(diagnostic), request);
  }

  static deleteAll() {
    CsRefactoringRequests.map.clear();
    CsRefactoringRequests.requestsChangedEmitter.fire();
  }

  // TODO call abort() while deleting requests (deletaAll, deleteByFnRange as well)
  static delete(document: TextDocument) {
    CsRefactoringRequests.map.delete(document.uri.toString());
    CsRefactoringRequests.requestsChangedEmitter.fire();
  }

  // TODO BUG - this doesn't work with complex methods or complex conditionals where functionRange != diagnostic range
  static deleteByFnRange(document: TextDocument, functionRange: Range) {
    const map = CsRefactoringRequests.map.get(document.uri.toString());
    if (!map) {
      return;
    }
    const matchedKeys: string[] = [];
    map.forEach((req, key) => {
      if (req.fnToRefactor.range.isEqual(functionRange)) {
        matchedKeys.push(key);
      }
    });
    const anyDeleted = matchedKeys.map((key) => map.delete(key)).some((a) => a);
    anyDeleted && CsRefactoringRequests.requestsChangedEmitter.fire();
  }

  static get(document: TextDocument, diagnostic: Diagnostic) {
    const map = CsRefactoringRequests.map.get(document.uri.toString());
    if (!map) {
      return;
    }
    return map.get(diagKey(diagnostic));
  }

  static getAll(document: TextDocument) {
    const map = CsRefactoringRequests.map.get(document.uri.toString());
    if (!map) {
      return [];
    }
    return [...map.values()];
  }
}

function diagKey(diagnostic: Diagnostic) {
  if (!isDefined(diagnostic.code)) {
    return `${diagnostic.message}-${rangeStr(diagnostic.range)}`;
  }
  if (typeof diagnostic.code === 'object') {
    return `${diagnostic.code.value}-${rangeStr(diagnostic.range)}`;
  }
  return `${diagnostic.code}-${rangeStr(diagnostic.range)}`;
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
