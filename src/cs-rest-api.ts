import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import vscode from 'vscode';
import { CodeSceneAuthenticationSession } from './auth/auth-provider';
import { Coupling } from './coupling/model';
import { logOutputChannel } from './log';
import { FnToRefactor } from './refactoring/commands';
import { CsServerVersion } from './server-version';
import { PreFlightResponse, RefactorRequest, RefactorResponse } from './refactoring/model';
import { getFileExtension } from './utils';
import { getPortalUrl } from './configuration';

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
        logOutputChannel.debug(`adding auth ${this.session.accessToken}`);
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
        logOutputChannel.error(msg);
        throw new Error(msg);
      }
      CsRestApi._instance = new CsRestApi(extension);
    }
    return CsRestApi._instance;
  }

  setSession(session?: vscode.AuthenticationSession) {
    this.session = session;
  }

  private isCodeSceneSession(x: vscode.AuthenticationSession): x is CodeSceneAuthenticationSession {
    return (<CodeSceneAuthenticationSession>x).url !== undefined;
  }

  private async getServerApiUrl() {
    let url: string;
    let serverType: string;
    if (this.session && this.isCodeSceneSession(this.session)) {
      let session = this.session as CodeSceneAuthenticationSession;
      url = session.url;
      serverType = session.version.server;
    } else {
      const info = await CsServerVersion.info;
      url = info.url;
      serverType = info.version.server;
    }
    let apiUrl;
    if (serverType === 'cloud') {
      if (url === 'https://staging.codescene.io') {
        apiUrl = 'https://api-staging.codescene.io';
      } else if (url === 'https://codescene.io') {
        apiUrl = 'https://api.codescene.io';
      } else {
        apiUrl = url;
      }
    } else {
      // onprem
      apiUrl = url + '/api';
    }
    logOutputChannel.trace(`Using API URL: ${apiUrl}`);
    return apiUrl;
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
    const serverUrl = await this.getServerApiUrl();
    const couplingsUrl = `${serverUrl}/v2/devtools/projects/${projectId}/couplings`;

    const rawData = await this.fetchJson<{ [key: string]: any }[]>(couplingsUrl);

    rawData.forEach((entity) => {
      entity.averageRevs = entity['average_revs'];
      delete entity['average_revs'];
    });

    return rawData as Coupling[];
  }

  async fetchProjects() {
    const serverUrl = await this.getServerApiUrl();
    const projectsUrl = serverUrl + '/v2/devtools/projects';
    return await this.fetchJson<{ id: number; name: string }[]>(projectsUrl);
  }

  async fetchRefactorPreflight() {
    const preflightUrl = `${getPortalUrl()}/api/refactor/preflight`;
    return this.fetchJson<PreFlightResponse>(preflightUrl);
  }

  private refactorUrl() {
    let isCloudSession = false;
    if (this.session && this.isCodeSceneSession(this.session)) {
      let session = this.session as CodeSceneAuthenticationSession;
      if (session.version.server === 'cloud') {
        isCloudSession = true;
      }
    }
    return isCloudSession ? `${getPortalUrl()}/api/refactor` : `${getPortalUrl()}/api/refactor/anon`;
  }

  private refactorRequest(fnToRefactor: FnToRefactor) {
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
        'file-type': getFileExtension(fnToRefactor.fileName),
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
    return await this.postForJson<RefactorResponse>(this.refactorUrl(), this.refactorRequest(fnToRefactor), config);
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
