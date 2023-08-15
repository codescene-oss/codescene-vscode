// This module provides a global interface to the CodeScene telemetry singleton.
import * as vscode from 'vscode';
import axios, { AxiosRequestConfig } from 'axios';
import { sign } from './codescene-interop';
import { ExecResult } from './executor';

export default class Telemetry {
  private static _instance: Telemetry;

  private telemetryLogger: vscode.TelemetryLogger;

  constructor(private cliPath: string) {
    const sender: vscode.TelemetrySender = {
      sendEventData: async (eventName, eventData) => {
        this.postTelemetry(eventName, eventData);
      },
      sendErrorData: (error) => {
        console.log(error);
      },
    };

    this.telemetryLogger = vscode.env.createTelemetryLogger(sender);
  }

  static init(cliPath: string): void {
    console.log('CodeScene: initializing telemetry logger');
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
    };


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

    axios.post('https://devtools.codescene.io/api/analytics/events/ide', jsonData, config).catch((error) => {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.log('CodeScene telemetry error: server responded with status ', error.response.status);
      } else if (error.request) {
        // The request was made but no response was received
        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
        // http.ClientRequest in node.js
        console.log('CodeScene telemetry error: the request was made but no response was received.');
      } else {
        // Something happened in setting up the request that triggered an Error
        console.log('CodeScene telemetry error: ', error.message);
      }
    });
  }
}
