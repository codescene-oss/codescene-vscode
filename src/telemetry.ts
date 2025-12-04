// This module provides a global interface to the CodeScene telemetry singleton.
import * as vscode from 'vscode';
import { getConfiguration } from './configuration';
import { CsExtensionState } from './cs-extension-state';
import { DevtoolsAPI } from './devtools-api';
import { TelemetryEvent } from './devtools-api/telemetry-model';
import { logOutputChannel } from './log';
import { serializeError } from './utils';

export default class Telemetry {
  private static _instance?: Telemetry;

  private static eventPrefix = 'vscode';
  private static sentErrorsCount = 0;
  private static readonly MAX_ERRORS_TO_SEND = 5;
  private telemetryLogger: vscode.TelemetryLogger;

  static serializeErrorWithExtraData(error: Error, data?: Record<string, any>): Record<string, any> {
    const serializedError = serializeError(error);
    return data ? { ...serializedError, extraData: data } : serializedError;
  }

  static isFullyRedacted(telemetryData: Record<string, any>): boolean {
    const message = telemetryData.message;
    const stack = telemetryData.stack;
    const redacted = '<REDACTED: Generic Secret>';

    if (message === redacted && stack === redacted) {
      return true;
    }

    if ((message === redacted && !stack) || (stack === redacted && !message)) {
      return true;
    }

    return false;
  }

  constructor(private extension: vscode.Extension<any>) {
    const sender: vscode.TelemetrySender = {
      sendEventData: (eventName, eventData) => {
        // The telemetry-sender apparently adds the extension id to the event name - replace it manually here to keep it simple for Amplitude users
        const evtName = eventName.replace(extension.id, Telemetry.eventPrefix);
        void this.postTelemetry(evtName, eventData);
      },
      sendErrorData: (error: Error, data?: Record<string, any>) => {
        try {
          const msg = error.message || '';
          if (!DevtoolsAPI.networkError && !msg.toLowerCase().includes("telemetry")){ // Avoid recursion
            Telemetry.logError(error, false, data);
          }
        } catch (omit) {
          // Do nothing - can't risk entering in some sort of error loop if failing when reporting errors
        }
      },
    };

    this.telemetryLogger = vscode.env.createTelemetryLogger(sender,
                                                            // Important: let the Telemetry instance handle uncaught exceptions,
                                                            // as propagated by VS Code:
                                                            { ignoreUnhandledErrors: false });
  }

  static async init(context: vscode.ExtensionContext): Promise<void> {
    try {
      // this `void` used to be an `await`, but it turned out to needlessly block execution.
      // `checkFirstRun` doesn't immediately change the settings value anyway - it just opens a settings form.
      void this.checkFirstRun();

      const enableTelemetry = getConfiguration('enableTelemetry');
      if (enableTelemetry) {
        logOutputChannel.info('Initializing telemetry logger');
        this._instance = new Telemetry(context.extension);
      } else {
        logOutputChannel.debug('Telemetry is disabled by user preference');
      }

      // Listen for changes in telemetry setting
      const disposable = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('enableTelemetry')) {
          Telemetry.refreshConfig(context.extension);
        }
      });

      context.subscriptions.push(disposable);
    } catch (error) {
      logOutputChannel.error('Error during telemetry initialization:', error);
      this._instance = undefined; // Ensure instance is cleared on error
    }
  }

  static logUsage(eventName: string, eventData?: any) {
    if (!Telemetry._instance) {
      return;
    }
    Telemetry._instance.telemetryLogger.logUsage(eventName, eventData);
  }

  static logError(error: Error, skipLogging: boolean, data?: Record<string, any>) {
    if (!Telemetry._instance) {
      return;
    }

    if (Telemetry.sentErrorsCount >= Telemetry.MAX_ERRORS_TO_SEND) {
      // Never send more than MAX_ERRORS_TO_SEND errors over Telemetry per session.
      // This is a last-resource measure to prevent recursive or otherwise excessive reporting
      // (besides other existing measures)
      return;
    }

    // note that stacktraces and other user data are already sanitized by VS Code, which is perfect for us.
    if (!skipLogging){
      logOutputChannel.error(error, data);
    }

    const telemetryData = Telemetry.serializeErrorWithExtraData(error, data);

    // If the Error has no useful data, don't send it over the network
    if (Telemetry.isFullyRedacted(telemetryData)) {
      return;
    }

    try {
      void Telemetry._instance.postTelemetry('vscode/unhandledError', telemetryData);
    } catch (omit) {
      // Do nothing - can't risk entering in some sort of error loop if failing when reporting errors
    } finally {
      Telemetry.sentErrorsCount++;
    }
  }

  private async postTelemetry(eventName: string, eventData: any) {
    try {
      await this.postTelemetryImpl(eventName, eventData);
    } catch (e) {
      logOutputChannel.error(JSON.stringify(e instanceof Error ? serializeError(e) : e));
    }
  }

  private async postTelemetryImpl(eventName: string, eventData: any) {
    if (!getConfiguration('enableTelemetry')){
      return;
    }
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

  private static async checkFirstRun() {
    if (!CsExtensionState.telemetryNoticeShown) {
      const openSettings = 'Open Settings';
      const selection = await vscode.window.showInformationMessage(
        'Telemetry is enabled by default to help improve this extension. You can disable it in the settings.',
        openSettings
      );

      if (selection === openSettings) {
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:codescene.codescene-vscode');
      }

      // Mark that the first run notice has been shown
      await CsExtensionState.setTelemetryNoticeShown(true);
    }
  }

  private static refreshConfig(extension: vscode.Extension<any>) {
    const enableTelemetry = getConfiguration('enableTelemetry');
    if (enableTelemetry && !this._instance) {
      logOutputChannel.info('Enabling telemetry at runtime');
      this._instance = new Telemetry(extension);
    } else if (!enableTelemetry && this._instance) {
      logOutputChannel.info('Disabling telemetry at runtime');
      this._instance.dispose();
      this._instance = undefined;
    }
  }

  dispose() {
    Telemetry.sentErrorsCount = 0;
    logOutputChannel.info('Telemetry logger disposed');
    this.telemetryLogger.dispose();
  }
}
