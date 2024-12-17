import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import vscode from 'vscode';
import { CodeSceneAuthenticationSession } from './auth/auth-provider';
import { CsExtensionState } from './cs-extension-state';
import { logOutputChannel } from './log';

const defaultTimeout = 10000;

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

  public async getRequest<T>(url: string, config?: AxiosRequestConfig) {
    const conf = Object.assign({ headers: { Accept: 'application/json' } }, config);
    const response = await this.axiosInstance.get(url, conf);
    return response.data as T;
  }

  public async postRequest<T>(url: string, data: any, config?: AxiosRequestConfig) {
    const conf = Object.assign({ headers: { Accept: 'application/json' } }, config);
    const response = await this.axiosInstance.post(url, data, conf);
    return response.data as T;
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
