import axios, { AxiosError, AxiosResponse } from 'axios';
import vscode from 'vscode';
import { getServerUrl } from './configuration';
import { logOutputChannel } from './log';

export interface ServerVersion {
  server: string;
  major: number;
  minor: number;
  patch: number;
  q?: number;
}

export interface ServerInfo {
  version: ServerVersion;
  url: string;
}

interface Changed {
  serverChanged: boolean;
  versionChanged: boolean;
}

export class CsServerVersion {
  private static _instance: CsServerVersion;
  private info: Promise<ServerInfo>;

  constructor() {
    this.info = this.loadVersion();
  }

  static init() {
    CsServerVersion._instance = new CsServerVersion();
  }

  private async loadVersion(): Promise<ServerInfo> {
    const url = getServerUrl() || 'https://codescene.io';
    logOutputChannel.debug(`Fetching server version from ${url}`);
    let cloudVersion = {
      server: 'cloud',
      major: 0,
      minor: 0,
      patch: 0,
    };
    try {
      const response: AxiosResponse = await axios.get(`${url}/version`);
      const contentType = response.headers['content-type'];

      if (contentType.includes('application/json')) {
        return { version: response.data, url: url };
      } else {
        // cloud returns text/html
        return { version: cloudVersion, url: url };
      }
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 500) {
          // that's cloud dev that hasn't had a version template generated
          logOutputChannel.debug('Cloud dev version detected');
        } else if (error.code === 'ECONNREFUSED') {
          void vscode.window.showErrorMessage(`Cannot fetch version from CodeScene server. Connection refused`);
        } else {
          void vscode.window.showErrorMessage(`Cannot fetch version from CodeScene server. ${error as Error}`);
        }
        return { version: cloudVersion, url: url };
      } else {
        void vscode.window.showErrorMessage(`Cannot connect to CodeScene server. ${error as Error}`);
        return { version: cloudVersion, url: url };
      }
    }
  }

  public static async reloadVersion(): Promise<Changed> {
    const info = await CsServerVersion._instance.info;
    const newInfoPromise = CsServerVersion._instance.loadVersion();
    CsServerVersion._instance.info = newInfoPromise;
    return serverChanges(info, await newInfoPromise);
  }

  static get info() {
    return CsServerVersion._instance.info;
  }
}

function serverChanges(prev: ServerInfo, curr: ServerInfo): Changed {
  const sameServer = prev.url === curr.url && prev.version.server === curr.version.server;
  const sameVersion =
    sameServer &&
    prev.version.major === curr.version.major &&
    prev.version.minor === curr.version.minor &&
    prev.version.patch === curr.version.patch;
  return { serverChanged: !sameServer, versionChanged: !sameVersion };
}
