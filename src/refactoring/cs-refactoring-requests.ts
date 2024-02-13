import { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter, Diagnostic, TextDocument, Uri } from 'vscode';
import { CsRestApi, RefactorConfidence, RefactorResponse } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import { isDefined, rangeStr } from '../utils';
import { CsRefactorCodeLensProvider } from './codelens';
import { FnToRefactor } from './command';

export class CsRefactoringRequest {
  resolvedResponse?: RefactorResponse;
  error?: string;
  refactorResponse?: Promise<RefactorResponse | string>;
  fnToRefactor: FnToRefactor;
  traceId: string;
  private abortController: AbortController;

  constructor(fnToRefactor: FnToRefactor) {
    this.fnToRefactor = fnToRefactor;
    this.traceId = uuidv4();
    this.abortController = new AbortController();
  }

  post(csRestApi: CsRestApi, diagnostics: Diagnostic[]) {
    logOutputChannel.debug(`Refactor request for ${this.logIdString(this.traceId, this.fnToRefactor)}`);
    this.refactorResponse = csRestApi
      .fetchRefactoring(diagnostics, this.fnToRefactor, this.traceId, this.abortController.signal)
      .then((response) => {
        if (!this.validConfidenceLevel(response.confidence.level)) {
          this.error = `Invalid confidence level: ${this.confidenceString(response.confidence)}`;
          logOutputChannel.error(
            `Refactor response error for ${this.logIdString(this.traceId, this.fnToRefactor)}: ${this.error}`
          );
          return this.error;
        }
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
  private static readonly map: Map<Uri, Map<Diagnostic, CsRefactoringRequest>> = new Map();

  private static readonly requestsEmitter = new EventEmitter<void>();
  static readonly onDidChangeRequests = CsRefactoringRequests.requestsEmitter.event;

  static initiate(
    context: { csRestApi: CsRestApi; document: TextDocument; codeLensProvider: CsRefactorCodeLensProvider },
    fnsToRefactor: FnToRefactor[],
    diagnostics: Diagnostic[]
  ) {
    fnsToRefactor.forEach(async (fn) => {
      const diagnosticsForFn = diagnostics.filter((d) => fn.range.contains(d.range));
      const req = new CsRefactoringRequest(fn);
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

  static set(document: TextDocument, diagnostic: Diagnostic, request: CsRefactoringRequest) {
    let map = CsRefactoringRequests.map.get(document.uri);
    if (!map) {
      map = new Map();
      CsRefactoringRequests.map.set(document.uri, map);
    }
    map.set(diagnostic, request);
  }

  static get(document: TextDocument, diagnostic: Diagnostic) {
    const map = CsRefactoringRequests.map.get(document.uri);
    if (!map) {
      return;
    }
    return map.get(diagnostic);
  }

  static getAll(document: TextDocument) {
    const map = CsRefactoringRequests.map.get(document.uri);
    if (!map) {
      return [];
    }
    return [...map.values()];
  }
}
