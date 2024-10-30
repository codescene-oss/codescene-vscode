import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import vscode from 'vscode';
import { CodeSceneAuthenticationSession } from './auth/auth-provider';
import { Coupling } from './coupling/model';
import { CsExtensionState } from './cs-extension-state';
import { logOutputChannel } from './log';
import { RefactorRequest } from './refactoring/model';
import { CsServerVersion } from './server-version';

const defaultTimeout = 10000;

// TODO - rename, this is basically just an axios wrapper (after cleaning up the fetchprojects and couplings)
export class CsRestApi {
  private static _instance: CsRestApi;

  private axiosInstance: AxiosInstance;

  constructor(extension: vscode.Extension<any>) {
    this.axiosInstance = axios.create({
      timeout: defaultTimeout,
      headers: {
        'User-Agent': `${extension.id}/${extension.packageJSON.version} axios/${axios.VERSION}`,
      },
    });

    this.axiosInstance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
      logOutputChannel.debug(`[${config.method}] ${config.url}`);
      if (CsExtensionState.stateProperties.session) {
        logOutputChannel.debug(`adding auth ${CsExtensionState.stateProperties.session.accessToken}`);
        config.headers['Authorization'] = `Bearer ${CsExtensionState.stateProperties.session.accessToken}`;
      }
      return config;
    });

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

  private async getServerApiUrl() {
    let url: string;
    let serverType: string;
    if (CsExtensionState.stateProperties.session && isCodeSceneSession(CsExtensionState.stateProperties.session)) {
      let session = CsExtensionState.stateProperties.session as CodeSceneAuthenticationSession;
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

  public async getRequest<T>(url: string, config?: AxiosRequestConfig) {
    const conf = Object.assign({ headers: { Accept: 'application/json' } }, config);
    const response = await this.axiosInstance.get(url, conf);
    return response.data as T;
  }

  public async postRequest<T>(url: string, data: RefactorRequest, config?: AxiosRequestConfig) {
    const conf = Object.assign({ headers: { Accept: 'application/json' } }, config);
    const response = await this.axiosInstance.post(url, data, conf);
    return response.data as T;
  }

  /** deprecated - TODO, remove */
  async fetchCouplings(projectId: number) {
    const serverUrl = await this.getServerApiUrl();
    const couplingsUrl = `${serverUrl}/v2/devtools/projects/${projectId}/couplings`;

    const rawData = await this.getRequest<{ [key: string]: any }[]>(couplingsUrl);

    rawData.forEach((entity) => {
      entity.averageRevs = entity['average_revs'];
      delete entity['average_revs'];
    });

    return rawData as Coupling[];
  }

  /** deprecated - TODO, remove along with /couplings */
  async fetchProjects() {
    const serverUrl = await this.getServerApiUrl();
    const projectsUrl = serverUrl + '/v2/devtools/projects';
    return await this.getRequest<{ id: number; name: string }[]>(projectsUrl);
  }
}

function logResponse(response: AxiosResponse) {
  const { config, status, statusText } = response;
  logOutputChannel.debug(`${config.url} [${status}] ${statusText}`);
  return response;
}

export function logAxiosError(error: any) {
  if (error.response) {
    const { config, status, statusText, data } = error.response;
    // The request was made and the server responded with a status code != 2xx
    logOutputChannel.error(
      `[${config.method}] ${config.url} [${status}] ${statusText} ${data ? JSON.stringify(data) : ''}`
    );
  } else if (error.request) {
    // The request was made but no response was received
    logOutputChannel.error(`Error in request - no response received: ${error}`);
  } else {
    // Something happened in setting up the request that triggered an Error
    logOutputChannel.error(`Request error: ${error.message}`);
  }
  return Promise.reject(error);
}

export function isCodeSceneSession(x: vscode.AuthenticationSession): x is CodeSceneAuthenticationSession {
  return (<CodeSceneAuthenticationSession>x).url !== undefined;
}
