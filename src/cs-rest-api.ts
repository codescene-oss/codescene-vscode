import * as vscode from 'vscode';
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { AUTH_TYPE } from './auth/auth-provider';
import { outputChannel } from './log';
import { getServerApiUrl } from './configuration';

export interface Coupling {
  entity: string;
  coupled: string;
  degree: number;
  averageRevs: number;
}

export class CsRestApi {
  private axiosInstance: AxiosInstance;

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

    this.axiosInstance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        const token = await getToken();
        const baseUrl = getServerApiUrl() + '/v2/devtools';
        if (config.url && config.url.startsWith(baseUrl)) {
          config.headers['Accept'] = 'application/json';
          config.headers['Authorization'] = `Bearer ${token}`;
        }

        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );
  }

  private async fetchJson<T>(url: string) {
    const response = await this.axiosInstance.get(url);
    outputChannel.appendLine(`GET ${url} ${response.status}`);
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
}
