import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import vscode from 'vscode';
import { getServerApiUrl } from './configuration';
import { Coupling } from './coupling/model';
import { logOutputChannel, outputChannel } from './log';
import { FnToRefactor } from './refactoring/commands';
import { PreFlightResponse, RefactorRequest, RefactorResponse } from './refactoring/model';

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

  async fetchRefactoring(fnToRefactor: FnToRefactor, traceId: string, signal?: AbortSignal) {
    const config: AxiosRequestConfig = {
      headers: {
        'x-codescene-trace-id': traceId,
      },
      timeout: refactoringTimeout,
      signal,
    };
    const refactorUrl = `${getServerApiUrl()}/v2/refactor/`;

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
        'file-type': fnToRefactor.fileType,
        'function-type': fnToRefactor.functionType,
        body: fnToRefactor.content,
      },
    };
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
