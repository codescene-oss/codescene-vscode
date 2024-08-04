import axios, { AxiosError, AxiosResponse } from 'axios';
import vscode from 'vscode';
import { logOutputChannel, outputChannel } from './log';
import { getServerUrl } from './configuration';

export interface ServerVersion {
  server: string;
  major: number;
  minor: number;
  patch: number;
  q: number | undefined;
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

  private changes(prev: ServerInfo, curr: ServerInfo): Changed {
    const sameServer = prev.url === curr.url
      && prev.version.server === curr.version.server;
    const sameVersion = sameServer
      && prev.version.major === curr.version.major
      && prev.version.minor === curr.version.minor
      && prev.version.patch === curr.version.patch;
    return {serverChanged: !sameServer, versionChanged: !sameVersion};
  }

  private async loadVersion(): Promise<ServerInfo> {
    const url = getServerUrl() || 'https://codescene.io';
    logOutputChannel.info(`Fetching server version from ${url}`);
    let version: ServerVersion;
    let cloudVersion = {
      server: 'cloud',
      major: 0,
      minor: 0,
      patch: 0,
      q: undefined
    };
    try {
      const response: AxiosResponse = await axios.get(`${url}/version`);
      const contentType = response.headers['content-type'];

      if (contentType.includes('application/json')) {
        return {version: response.data, url: url};
      } else {
        // cloud returns text/html
        return {version: cloudVersion, url: url};
      }
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 500) {
          // that's cloud dev that hasn't had a version template generated
          logOutputChannel.debug("Cloud dev version detected");
        } else if (error.code === 'ECONNREFUSED') {
          void vscode.window.showErrorMessage(`Cannot fetch version from CodeScene server. Connection refused`);
        } else {
          void vscode.window.showErrorMessage(`Cannot fetch version from CodeScene server. ${error as Error}`);
        }
        return {version: cloudVersion, url: url};
      } else {
        void vscode.window.showErrorMessage(`Cannot connect to CodeScene server. ${error as Error}`);
        return {version: cloudVersion, url: url};
      }
    }
  }

  public async reloadVersion(): Promise<Changed> {
    let info = await this.info;
    this.info = this.loadVersion();
    let newInfo = await this.info;
    return this.changes(info, newInfo);
  }

  static get info() {
    return CsServerVersion._instance.info;
  }

  static init() {
    if (!CsServerVersion._instance) {
      CsServerVersion._instance = new CsServerVersion();
    }
    return CsServerVersion._instance;
  }

}
