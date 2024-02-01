import { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Diagnostic, Range, TextDocument, Uri } from 'vscode';
import { CsRestApi, RefactorConfidence, RefactorResponse } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import { keyStr, rangeStr } from '../utils';
import { CsRefactorCodeLensProvider } from './codelens';
import { FnToRefactor } from './command';

export class CsRefactoringRequest {
  resolvedResponse?: RefactorResponse;
  error?: string;
  refactorResponse?: Promise<RefactorResponse | string>;
  fnToRefactor: FnToRefactor;
  private abortController: AbortController;

  constructor(
    csRestApi: CsRestApi,
    codeLensProvider: CsRefactorCodeLensProvider,
    diagnostics: Diagnostic[],
    fnToRefactor: FnToRefactor
  ) {
    this.fnToRefactor = fnToRefactor;
    this.abortController = new AbortController();
    const traceId = uuidv4();
    logOutputChannel.info(`Refactor request for ${this.logIdString(traceId, fnToRefactor)}`);
    this.refactorResponse = csRestApi
      .fetchRefactoring(diagnostics, fnToRefactor, traceId, this.abortController.signal)
      .then((response) => {
        logOutputChannel.info(
          `Refactor response for ${this.logIdString(traceId, fnToRefactor)}: ${this.confidenceString(
            response.confidence
          )}`
        );
        if (!this.validConfidenceLevel(response.confidence.level)) {
          this.error = `Invalid confidence level: ${this.confidenceString(response.confidence)}`;
          logOutputChannel.error(
            `Refactor response error for ${this.logIdString(traceId, fnToRefactor)}: ${this.error}`
          );
          return this.error;
        }
        this.resolvedResponse = response;
        return response;
      })
      .catch((err: Error | AxiosError) => {
        this.error = err.message;
        if (err instanceof AxiosError) {
          this.error = `[${err.code}] ${err.message}`;
        }
        logOutputChannel.error(`Refactor response error for ${this.logIdString(traceId, fnToRefactor)}: ${this.error}`);
        return this.error;
      })
      .finally(() => {
        codeLensProvider.update();
      });
  }

  abort() {
    this.abortController.abort();
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
}
