/* eslint-disable @typescript-eslint/naming-convention */
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import * as vscode from 'vscode';
import { getServerApiUrl } from './configuration';
import { logOutputChannel, outputChannel } from './log';
import { FnToRefactor } from './refactoring/commands';

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

export interface ReasonsWithDetails {
  summary: string;
  details?: ReasonDetails[];
}

export interface RefactorResponse {
  confidence: RefactorConfidence;
  'reasons-with-details': ReasonsWithDetails[];
  'refactoring-properties': RefactorProperties;
  code: string;
}

const defaultTimeout = 10000;
const refactoringTimeout = 60000;

export class CsRestApi {
  private static _instance: CsRestApi;

  private axiosInstance: AxiosInstance;
  private session?: vscode.AuthenticationSession;

  constructor(extension: vscode.Extension<any>) {
    this.axiosInstance = axios.create({
      timeout: defaultTimeout,
      headers: {
        'User-Agent': `${extension.id}/${extension.packageJSON.version} axios/${axios.VERSION}`,
      },
    });

    this.axiosInstance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
      logOutputChannel.debug(`[${config.method}] ${config.url}`);
      if (this.session) {
        config.headers['Authorization'] = `Bearer ${this.session.accessToken}`;
      }
      return config;
    });

    const logResponse = (response: AxiosResponse) => {
      const { config, status, statusText } = response;
      logOutputChannel.debug(`${config.url} [${status}] ${statusText}`);
      return response;
    };

    this.axiosInstance.interceptors.response.use(logResponse, logAxiosError);
  }

  static get instance() {
    if (!CsRestApi._instance) {
      const extension = vscode.extensions.getExtension('codescene.codescene-vscode');
      if (!extension) {
        const msg = 'Could not initiate Rest API!';
        outputChannel.appendLine(msg);
        throw new Error(msg);
      }
      outputChannel.appendLine('Initializing Rest API');
      CsRestApi._instance = new CsRestApi(extension);
    }
    return CsRestApi._instance;
  }

  setSession(session?: vscode.AuthenticationSession) {
    this.session = session;
  }

  private async fetchJson<T>(url: string, config?: AxiosRequestConfig) {
    const conf = Object.assign({ headers: { Accept: 'application/json' } }, config);
    const response = await this.axiosInstance.get(url, conf);
    return response.data as T;
  }

  private async postForJson<T>(url: string, data: RefactorRequest, config?: AxiosRequestConfig) {
    const conf = Object.assign({ headers: { Accept: 'application/json' } }, config);
    const response = await this.axiosInstance.post(url, data, conf);
    return response.data as T;
  }

  async fetchCouplings(projectId: number) {
    const couplingsUrl = `${getServerApiUrl()}/v2/devtools/projects/${projectId}/couplings`;

    const rawData = await this.fetchJson<{ [key: string]: any }[]>(couplingsUrl);

    rawData.forEach((entity) => {
      entity.averageRevs = entity['average_revs'];
      delete entity['average_revs'];
    });

    return rawData as Coupling[];
  }

  async fetchProjects() {
    const projectsUrl = getServerApiUrl() + '/v2/devtools/projects';
    return await this.fetchJson<{ id: number; name: string }[]>(projectsUrl);
  }

  async fetchRefactorPreflight() {
    const refactorUrl = `${getServerApiUrl()}/v2/refactor/preflight`;
    return this.fetchJson<PreFlightResponse>(refactorUrl);
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
      timeout: refactoringTimeout,
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
    return await this.postForJson<RefactorResponse>(refactorUrl, request, config);
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
