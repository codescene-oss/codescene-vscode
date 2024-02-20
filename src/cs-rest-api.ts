/* eslint-disable @typescript-eslint/naming-convention */
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import * as vscode from 'vscode';
import { AUTH_TYPE } from './auth/auth-provider';
import { getServerApiUrl } from './configuration';
import { logOutputChannel, outputChannel } from './log';
import { FnToRefactor } from './refactoring/command';

export interface Coupling {
  entity: string;
  coupled: string;
  degree: number;
  averageRevs: number;
}

export interface RefactoringSupport {
  'file-types': string[];
  'code-smells': string[];
}

export interface PreFlightResponse {
  supported: RefactoringSupport;
  'max-input-tokens': number;
  'max-input-loc': number;
}

interface Review {
  category: string; // Type of issue
  'start-line': number; // Start line of the issue relative to the source snippet
  'end-line'?: number; // Currently optional line of the issue relative to the source snippet
}

interface SourceSnippet {
  'file-type': string; // file extension
  'function-type': string; // Function type (specified by cli tool)
  body: string; // Function body
}

export interface RefactorRequest {
  review: Review[];
  'source-snippet': SourceSnippet;
}

export interface RefactorConfidence {
  description: string;
  title: string;
  level: number;
  'recommended-action': { description: string; details: string };
}
interface RefactorProperties {
  'added-code-smells': string[];
  'removed-code-smells': string[];
}

interface ReasonDetails {
  message: string;
  lines: number[];
  columns: number[];
}

interface ReasonsWithDetails {
  summary: string;
  details?: ReasonDetails[];
}

export interface RefactorResponse {
  confidence: RefactorConfidence;
  'reasons-with-details': ReasonsWithDetails[];
  'refactoring-properties': RefactorProperties;
  code: string;
}

export class CsRestApi {
  private axiosInstance: AxiosInstance;
  private refactoringAxiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 5000,
    });

    const getToken = async () => {
      const session = await vscode.authentication.getSession(AUTH_TYPE, [], { createIfNone: false });
      if (session) {
        return session.accessToken;
      }
    };

    const conditionalAddConfig = async (url: string, config: InternalAxiosRequestConfig) => {
      if (config.url && config.url.startsWith(url)) {
        const token = await getToken();
        config.headers['Accept'] = 'application/json';
        config.headers['Authorization'] = `Bearer ${token}`;
      }
    };

    this.axiosInstance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
      logOutputChannel.debug(`[${config.method}] ${config.url}`);
      const baseUrl = getServerApiUrl() + '/v2/devtools';
      await conditionalAddConfig(baseUrl, config);
      return config;
    });

    const logResponse = (response: AxiosResponse) => {
      const { config, status, statusText } = response;
      logOutputChannel.debug(`${config.url} [${status}] ${statusText}`);
      return response;
    };

    this.axiosInstance.interceptors.response.use(logResponse, logAxiosError);

    this.refactoringAxiosInstance = axios.create({
      timeout: 60000,
    });

    this.refactoringAxiosInstance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
      logOutputChannel.debug(`[${config.method}] ${config.url}`);
      const baseUrl = getServerApiUrl() + '/v2/refactor';
      await conditionalAddConfig(baseUrl, config);
      return config;
    });
    this.refactoringAxiosInstance.interceptors.response.use(logResponse, logAxiosError);
  }

  private async fetchJson<T>(url: string) {
    const response = await this.axiosInstance.get(url);
    return response.data as T;
  }

  private async refactoringPostJson<T>(url: string, data: RefactorRequest, config: AxiosRequestConfig) {
    const response = await this.refactoringAxiosInstance.post(url, data, config);
    return response.data as T;
  }

  async fetchCouplings(projectId: number) {
    const couplingsUrl = `${getServerApiUrl()}/v2/devtools/projects/${projectId}/couplings`;

    const rawData = await this.fetchJson<{ [key: string]: any }[]>(couplingsUrl);

    rawData.forEach((entity) => {
      entity.averageRevs = entity['average_revs'];
      delete entity['average_revs'];
    });

    const data = rawData as Coupling[];

    return data;
  }

  async fetchProjects() {
    const projectsUrl = getServerApiUrl() + '/v2/devtools/projects';
    return await this.fetchJson<{ id: number; name: string }[]>(projectsUrl);
  }

  async fetchRefactoring(
    diagnostics: vscode.Diagnostic[],
    fnToRefactor: FnToRefactor,
    traceId: string,
    signal?: AbortSignal
  ) {
    const config: AxiosRequestConfig = {
      headers: {
        'x-codescene-trace-id': traceId,
      },
      signal,
    };
    const refactorUrl = `${getServerApiUrl()}/v2/refactor/`;

    const codeToCategory = (
      diagnosticCode: string | number | { value: string | number; target: vscode.Uri } | undefined
    ) => {
      if (typeof diagnosticCode === 'object') {
        return diagnosticCode.value.toString();
      }
      return 'unknown category';
    };

    const reviews = diagnostics.map((diagnostic) => ({
      category: codeToCategory(diagnostic.code),
      'start-line': diagnostic.range.start.line - fnToRefactor.range.start.line,
      'end-line': diagnostic.range.end.line - fnToRefactor.range.start.line,
    }));

    const sourceSnippet: SourceSnippet = {
      'file-type': fnToRefactor['file-type'],
      'function-type': fnToRefactor.functionType,
      body: fnToRefactor.content,
    };
    const request: RefactorRequest = { review: reviews, 'source-snippet': sourceSnippet };
    return await this.refactoringPostJson<RefactorResponse>(refactorUrl, request, config);
  }

  /**
   * Makes a preflight request to the REST API to check what capabilities the refactoring service has.
   * Returns void and shows an error message if the request was unsuccessful. This might indicate that
   * the user doesn't have the required priviliges, causing the extension to start without refactoring
   * capabilities.
   *
   * @returns
   */
  async fetchRefactorPreflight() {
    const refactorUrl = `${getServerApiUrl()}/v2/refactor/preflight`;
    return this.refactoringAxiosInstance.get(refactorUrl).then(
      (response) => {
        return response.data as PreFlightResponse;
      },
      (error) => {
        const { message } = error;
        outputChannel.appendLine(`Unable to fetch refactoring capabilities. ${message}`);
        vscode.window.showErrorMessage(`Unable to fetch refactoring capabilities. ${message}`);
      }
    );
  }
}

export function logAxiosError(error: any) {
  if (error.response) {
    const { config, status, statusText } = error.response;
    // The request was made and the server responded with a status code != 2xx
    logOutputChannel.error(`[${config.method}] ${config.url} [${status}] ${statusText}`);
  } else if (error.request) {
    // The request was made but no response was received
    logOutputChannel.error(`Error in request - no response received: ${error}`);
  } else {
    // Something happened in setting up the request that triggered an Error
    logOutputChannel.error(`Request error: ${error.message}`);
  }
  return Promise.reject(error);
}
