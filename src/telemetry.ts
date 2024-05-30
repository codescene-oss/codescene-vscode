// This module provides a global interface to the CodeScene telemetry singleton.
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as vscode from 'vscode';
import { sign } from './codescene-interop';
import { logAxiosError } from './cs-rest-api';
import { ExecResult } from './executor';
import { logOutputChannel, outputChannel } from './log';

export default class Telemetry {
  private static _instance: Telemetry;

  private telemetryLogger: vscode.TelemetryLogger;
  private axiosInstance: AxiosInstance;

  private session?: vscode.AuthenticationSession;

  constructor(extension: vscode.Extension<any>) {
    const sender: vscode.TelemetrySender = {
      sendEventData: (eventName, eventData) => {
        this.postTelemetry(eventName, eventData).catch(() => {}); // post but ignore errors (logged using logAxiosError in interceptor instead)
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

  static init(extension: vscode.Extension<any>): void {
    outputChannel.appendLine('Initializing telemetry logger');
    Telemetry._instance = new Telemetry(extension);
  }

  static get instance(): Telemetry {
    return Telemetry._instance;
  }

  logUsage(eventName: string, eventData?: any) {
    this.telemetryLogger.logUsage(eventName, eventData);
  }

  private async postTelemetry(eventName: string, eventData: any) {
    const data = {
      ...eventData,
      'event-time': new Date().toISOString(),
      'event-name': eventName,
      'editor-type': 'vscode',
      'process-platform': process.platform,
      'process-arch': process.arch,
    };
    if (this.session) {
      data['user-id'] = this.session.account.id;
    }
    // To ensure we are sending exactly the same data to the sign command as we are sending in the body of the request,
    // we stringify the data manually.
    const jsonData = JSON.stringify(data);
    const signResult: ExecResult = await sign(jsonData);

    const config: AxiosRequestConfig = {
      headers: {
        'x-codescene-signature': signResult.stdout,
      },
    };

    return this.axiosInstance.post('https://devtools.codescene.io/api/analytics/events/ide', jsonData, config);
  }

  setSession(session?: vscode.AuthenticationSession) {
    this.session = session;
  }
}
