// This module provides a global interface to the CodeScene telemetry singleton.
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as vscode from 'vscode';
import { getPortalUrl } from './configuration';
import { CsExtensionState } from './cs-extension-state';
import { logAxiosError } from './cs-rest-api';
import { ExecResult, SimpleExecutor } from './executor';
import { logOutputChannel } from './log';
import { DevtoolsAPI } from './devtools-interop/api';

export default class Telemetry {
  private static _instance: Telemetry;

  private static eventPrefix = 'vscode';

  private telemetryLogger: vscode.TelemetryLogger;
  private axiosInstance: AxiosInstance;

  constructor(extension: vscode.Extension<any>, private devtoolsApi: DevtoolsAPI) {
    const sender: vscode.TelemetrySender = {
      sendEventData: (eventName, eventData) => {
        // The telemetry-sender apparently adds the extension id to the event name - replace it manually here to keep it simple for Amplitude users
        const evtName = eventName.replace(extension.id, Telemetry.eventPrefix);
        this.postToPortal(evtName, eventData).catch(() => {}); // post but ignore errors (logged using logAxiosError in interceptor instead)
      },
      sendErrorData: (error) => {
        logOutputChannel.error(error);
      },
    };
    this.axiosInstance = axios.create({
      timeout: 5000,
      headers: {
        'content-type': 'application/json',
        'User-Agent': `${extension.id}/${extension.packageJSON.version} axios/${axios.VERSION}`,
      },
    });
    this.axiosInstance.interceptors.response.use(undefined, logAxiosError);

    this.telemetryLogger = vscode.env.createTelemetryLogger(sender, { ignoreUnhandledErrors: true });
  }

  static init(extension: vscode.Extension<any>, devtoolsApi: DevtoolsAPI): void {
    logOutputChannel.info('Initializing telemetry logger');
    Telemetry._instance = new Telemetry(extension, devtoolsApi);
  }

  static logUsage(eventName: string, eventData?: any) {
    Telemetry._instance.telemetryLogger.logUsage(eventName, eventData);
  }

  private async postToPortal(eventName: string, eventData: any) {
    const data = {
      ...eventData,
      'event-time': new Date().toISOString(),
      'event-name': eventName,
      'editor-type': 'vscode',
      'process-platform': process.platform,
      'process-arch': process.arch,
    };
    if (CsExtensionState.stateProperties.session) {
      data['user-id'] = CsExtensionState.stateProperties.session.account.id;
    }
    if (process.env.X_CODESCENE_INTERNAL) {
      data['internal?'] = true;
    }

    // To ensure we are sending exactly the same data to the sign command as we are sending in the body of the request,
    // we stringify the data manually.
    const jsonData = JSON.stringify(data);
    const signResult = await this.devtoolsApi.sign(jsonData);

    const config: AxiosRequestConfig = {
      headers: {
        'x-codescene-signature': signResult,
      },
    };

    return this.axiosInstance.post(`${getPortalUrl()}/api/analytics/events/ide`, jsonData, config);
  }

  private logEventData(eventName: string, eventData: any, noCommonProps = true) {
    let dataToLog = eventData;
    if (noCommonProps) {
      // Remove all vscode common props before logging
      dataToLog = Object.keys(eventData).reduce((acc, key) => {
        if (!key.startsWith('common.')) {
          acc[key] = eventData[key];
        }
        return acc;
      }, {} as Record<string, any>);
    }
    logOutputChannel.debug(`[Telemetry] Event "${eventName}": ${JSON.stringify(dataToLog)}`);
  }
}
