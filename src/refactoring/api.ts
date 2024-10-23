import { AxiosError, AxiosRequestConfig, AxiosResponseHeaders, isAxiosError, RawAxiosResponseHeaders } from 'axios';
import * as vscode from 'vscode';
import { CodeSceneAuthenticationSession } from '../auth/auth-provider';
import { getPortalUrl } from '../configuration';
import { CsExtensionState } from '../cs-extension-state';
import { CsRestApi, isCodeSceneSession } from '../cs-rest-api';
import { logOutputChannel } from '../log';
import { getFileExtension, isDefined, rangeStr } from '../utils';
import { FnToRefactor } from './commands';
import { AceCredits, PreFlightResponse, RefactorConfidence, RefactorRequest, RefactorResponse } from './model';

const refactoringTimeout = 60000;

export class ACECreditsError extends Error {
  constructor(message: string, readonly creditsInfo: AceCredits) {
    super(message);
  }
}

export class RefactoringAPI {
  // create singleton instance of the api
  private static _instance: RefactoringAPI;

  // getter for the instance
  static get instance() {
    if (!RefactoringAPI._instance) {
      RefactoringAPI._instance = new RefactoringAPI();
    }
    return RefactoringAPI._instance;
  }

  preFlight() {
    return CsRestApi.instance.getRequest<PreFlightResponse>(`${getPortalUrl()}/api/refactor/preflight`);
  }

  private refactorUrl() {
    let isCloudSession = false;
    if (CsExtensionState.stateProperties.session && isCodeSceneSession(CsExtensionState.stateProperties.session)) {
      let session = CsExtensionState.stateProperties.session as CodeSceneAuthenticationSession;
      if (session.version.server === 'cloud') {
        isCloudSession = true;
      }
    }
    return isCloudSession ? `${getPortalUrl()}/api/refactor` : `${getPortalUrl()}/api/refactor/anon`;
  }

  private toRefactorRequestBody(fnToRefactor: FnToRefactor) {
    const reviews = fnToRefactor.codeSmells.map((codeSmell) => {
      return {
        category: codeSmell.category,
        'start-line': codeSmell.relativeStartLine,
        'end-line': codeSmell.relativeEndLine,
      };
    });

    const request: RefactorRequest = {
      review: reviews,
      'source-snippet': {
        'file-type': getFileExtension(fnToRefactor.filePath),
        'function-type': fnToRefactor.functionType,
        body: fnToRefactor.content,
      },
      'device-id': vscode.env.machineId,
    };

    return request;
  }

  async fetchRefactoring(fnToRefactor: FnToRefactor, traceId: string, signal?: AbortSignal) {
    const config: AxiosRequestConfig = {
      headers: {
        'x-codescene-trace-id': traceId,
      },
      timeout: refactoringTimeout,
      signal,
    };
    logOutputChannel.debug(`Refactor request for ${logIdString(traceId, fnToRefactor)}`);
    try {
      const refactorResponse = await CsRestApi.instance.postRequest<RefactorResponse>(
        this.refactorUrl(),
        this.toRefactorRequestBody(fnToRefactor),
        config
      );
      logOutputChannel.debug(
        `Refactor response for ${logIdString(traceId, fnToRefactor)}: ${confidenceString(refactorResponse.confidence)}`
      );
      return refactorResponse;
    } catch (error) {
      if (error instanceof Error) {
        logOutputChannel.error(`Refactor error for ${logIdString(traceId, fnToRefactor)}: ${error.message}`);
        if (isAxiosError(error)) {
          const msg = getErrorString(error);
          const creditInfo = toCreditInfo(error.response?.headers);
          // The refactoring API is designed to return 403 with some specific headers if the user has run out of credits
          // Throw a specific error in this case, to be able to handle separately in CsExtensionState
          if (isDefined(creditInfo)) {
            throw new ACECreditsError(msg, creditInfo);
          }
        }
      }
      throw error;
    }
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

function toCreditInfo(headers?: RawAxiosResponseHeaders | AxiosResponseHeaders): AceCredits | undefined {
  if (isDefined(headers) && isCreditHeadersDefined(headers)) {
    const creditInfo: AceCredits = {
      used: +headers['x-codescene-credits-used'],
      limit: +headers['x-codescene-limit'],
    };

    const resetTimeHeader = headers['x-codescene-credits-reset'];
    if (resetTimeHeader) {
      creditInfo.resetTime = new Date(resetTimeHeader);
    }
    return creditInfo;
  }
}

function isCreditHeadersDefined(headers: RawAxiosResponseHeaders | AxiosResponseHeaders): boolean {
  return isDefined(headers['x-codescene-credits-used']) && isDefined(headers['x-codescene-limit']);
}
