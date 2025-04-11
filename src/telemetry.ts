// This module provides a global interface to the CodeScene telemetry singleton.
import * as vscode from 'vscode';
import { CsExtensionState } from './cs-extension-state';
import { DevtoolsAPI } from './devtools-api';
import { TelemetryEvent } from './devtools-api/telemetry-model';
import { logOutputChannel } from './log';

export default class Telemetry {
  private static _instance?: Telemetry;

  private static eventPrefix = 'vscode';
  private telemetryLogger: vscode.TelemetryLogger;

  constructor(private extension: vscode.Extension<any>) {
    const sender: vscode.TelemetrySender = {
      sendEventData: (eventName, eventData) => {
        // The telemetry-sender apparently adds the extension id to the event name - replace it manually here to keep it simple for Amplitude users
        const evtName = eventName.replace(extension.id, Telemetry.eventPrefix);
        void this.postTelemetry(evtName, eventData);
      },
      sendErrorData: (error) => {
        logOutputChannel.error(error);
      },
    };

    this.telemetryLogger = vscode.env.createTelemetryLogger(sender, { ignoreUnhandledErrors: true });
  }

  static init(extension: vscode.Extension<any>): void {
    logOutputChannel.info('Initializing telemetry logger');
    Telemetry._instance = new Telemetry(extension);
  }

  static logUsage(eventName: string, eventData?: any) {
    if (!Telemetry._instance) {
      logOutputChannel.warn(`[Telemetry] Attempted to log event "${eventName}" before telemetry was initialized`);
      return;
    }
    Telemetry._instance.telemetryLogger.logUsage(eventName, eventData);
  }

  private async postTelemetry(eventName: string, eventData: any) {
    const telemetryEvent: TelemetryEvent = {
      ...eventData,
      'event-time': new Date().toISOString(),
      'event-name': eventName,
      'editor-type': 'vscode',
      'extension-version': this.extension.packageJSON.version,
      'process-platform': process.platform,
      'process-arch': process.arch,
    };
    if (CsExtensionState.stateProperties.session) {
      telemetryEvent['user-id'] = CsExtensionState.stateProperties.session.account.id;
    }
    if (process.env.X_CODESCENE_INTERNAL) {
      telemetryEvent['internal'] = true;
    }
    return DevtoolsAPI.postTelemetry(telemetryEvent);
  }
}
