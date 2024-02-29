// This module provides a global interface to the CodeScene telemetry singleton.
import axios, { AxiosRequestConfig } from 'axios';
import * as vscode from 'vscode';
import { sign } from './codescene-interop';
import { logAxiosError } from './cs-rest-api';
import { ExecResult } from './executor';
import { logOutputChannel, outputChannel } from './log';

export default class Telemetry {
  private static _instance: Telemetry;

  private telemetryLogger: vscode.TelemetryLogger;

  private session?: vscode.AuthenticationSession;

  constructor(private cliPath: string) {
    const sender: vscode.TelemetrySender = {
      sendEventData: async (eventName, eventData) => {
        this.postTelemetry(eventName, eventData);
      },
      sendErrorData: (error) => {
        logOutputChannel.error(error);
      },
    };

    this.telemetryLogger = vscode.env.createTelemetryLogger(sender);
  }

  static init(cliPath: string): void {
    outputChannel.appendLine('Initializing telemetry logger');
    Telemetry._instance = new Telemetry(cliPath);
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
    const signResult: ExecResult = await sign(this.cliPath, jsonData);

    const config: AxiosRequestConfig = {
      headers: {
        'content-type': 'application/json',
        'x-codescene-signature': signResult.stdout,
      },
      timeout: 5000, //milliseconds
    };

    axios.post('https://devtools.codescene.io/api/analytics/events/ide', jsonData, config).catch(logAxiosError);
  }

  setSession(session?: vscode.AuthenticationSession) {
    this.session = session;
  }
}
