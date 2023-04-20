// This module provides a global interface to the CodeScene telemetry singleton.
import * as vscode from 'vscode';
import axios from 'axios';
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

  logUsage(eventName: string) {
    this.telemetryLogger.logUsage(eventName);
  }

  private postTelemetry(eventName: string, eventData: any) {
    const config = {
      headers: { 'content-type': 'application/json' },
      timeout: 5000, //milliseconds
    };

    axios.interceptors.request.use(
      async (config) => {
        const signResult: ExecResult = await sign(this.cliPath, config.data);
        config.headers['x-codescene-signature'] = signResult.stdout;
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    const data = {
      ...eventData,
      'event-time': new Date().toISOString(),
      'event-name': eventName,
      'editor-type': 'vscode',
    };
    const jsonData = JSON.stringify(data); //for consistency in signature, we take care of jsonification here.

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
