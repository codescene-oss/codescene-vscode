import { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Diagnostic, EventEmitter, Range, TextDocument } from 'vscode';
import { CsRestApi, RefactorConfidence, RefactorResponse } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import { isDefined, rangeStr } from '../utils';
import { CsRefactorCodeLensProvider } from './codelens';
import { FnToRefactor } from './command';

export class CsRefactoringRequest {
  fnToRefactor: FnToRefactor;
  document: TextDocument;
  traceId: string;
  resolvedResponse?: RefactorResponse;
  error?: string;
  refactorResponse?: Promise<RefactorResponse | string>;
  private abortController: AbortController;

  constructor(fnToRefactor: FnToRefactor, document: TextDocument) {
    this.fnToRefactor = fnToRefactor;
    this.document = document;
    this.traceId = uuidv4();
    this.abortController = new AbortController();
  }

  post(csRestApi: CsRestApi, diagnostics: Diagnostic[]) {
    logOutputChannel.debug(`Refactor request for ${this.logIdString(this.traceId, this.fnToRefactor)}`);
    this.refactorResponse = csRestApi
      .fetchRefactoring(diagnostics, this.fnToRefactor, this.traceId, this.abortController.signal)
      .then((response) => {
        logOutputChannel.debug(
          `Refactor response for ${this.logIdString(this.traceId, this.fnToRefactor)}: ${this.confidenceString(
            response.confidence
          )}`
        );
        this.resolvedResponse = response;
        return response;
      })
      .catch((err: Error | AxiosError) => {
        this.error = err.message;
        if (err instanceof AxiosError) {
          this.error = this.getErrorString(err);
        }
        logOutputChannel.error(
          `Refactor response error for ${this.logIdString(this.traceId, this.fnToRefactor)}: ${this.error}`
        );
        return this.error;
      });
    return this.refactorResponse;
  }

  abort() {
    this.abortController.abort();
  }

  isPending() {
    return !isDefined(this.resolvedResponse) && !isDefined(this.error);
  }

  /**
   * Indicate that we should present the refactoring state in the UI
   * Rules at the moment is to basically always present it, unless the 
   * confidence level is invalid.
   * 
   * @param request
   * @returns 
   */
  shouldPresent() {
    const level = this.resolvedResponse?.confidence.level;
    if (isDefined(level)) {
      return this.validConfidenceLevel(level);
    }
    return true;
  }

  private getErrorString(err: AxiosError) {
    let defaultMsg = `[${err.code}] ${err.message}`;
    if (!isDefined(err.response)) return defaultMsg;

    const data = err.response?.data as { error?: string };
    return data.error ? `[${err.code}] ${data.error}` : defaultMsg;
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

/**
 * Map of diagnostics to refactoring requests - per document.
 * Used to get the proper requests when presenting the refactoring codelenses and codeactions.
 */
export class CsRefactoringRequests {
  private static readonly map: Map<string, Map<string, CsRefactoringRequest>> = new Map();

  private static readonly requestsEmitter = new EventEmitter<void>();
  static readonly onDidChangeRequests = CsRefactoringRequests.requestsEmitter.event;

  static initiate(
    context: { csRestApi: CsRestApi; document: TextDocument; codeLensProvider: CsRefactorCodeLensProvider },
    fnsToRefactor: FnToRefactor[],
    diagnostics: Diagnostic[]
  ) {
    fnsToRefactor.forEach(async (fn) => {
      const diagnosticsForFn = diagnostics.filter((d) => fn.range.contains(d.range));
      const req = new CsRefactoringRequest(fn, context.document);
      req.post(context.csRestApi, diagnosticsForFn).finally(() => {
        CsRefactoringRequests.requestsEmitter.fire(); // Fire updates for all finished requests
      });
      // Put the request for each diagnostic in a map for access in codelens and codeaction providers
      diagnosticsForFn.forEach((d) => {
        CsRefactoringRequests.set(context.document, d, req);
      });
    });
    CsRefactoringRequests.requestsEmitter.fire();
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

  static delete(document: TextDocument) {
    CsRefactoringRequests.map.delete(document.uri.toString());
    CsRefactoringRequests.requestsEmitter.fire();
  }

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
    let deleted = false;
    matchedKeys.forEach((key) => {
      deleted = deleted || map.delete(key);
    });
    deleted && CsRefactoringRequests.requestsEmitter.fire();
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
