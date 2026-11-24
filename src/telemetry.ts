// This module provides a global interface to the CodeScene telemetry singleton.
import * as vscode from 'vscode';
import { getConfiguration } from './configuration';
import { CsExtensionState, type CsStateProperties } from './cs-extension-state';
import { getExtensionSettingsFilter } from './extension-id';
import { DevtoolsAPI } from './devtools-api';
import { TelemetryEvent } from './devtools-api/telemetry-model';
import { logOutputChannel } from './log';
import { serializeError } from './utils';
import { kebabKeys } from './utils/kebab-keys';

function telemetryUserId({ auth, legacySession }: CsStateProperties): string | undefined {
  return auth.status?.user?.id ?? legacySession?.userId;
}

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
      sendErrorData: () => {},
    };

    this.telemetryLogger = vscode.env.createTelemetryLogger(sender, { ignoreUnhandledErrors: true });
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

  private async postTelemetry(eventName: string, eventData: any) {
    try {
      await this.postTelemetryImpl(eventName, eventData);
    } catch (e) {
      logOutputChannel.debug(JSON.stringify(e instanceof Error ? serializeError(e) : e));
    }
  }

  private async postTelemetryImpl(eventName: string, eventData: any) {
    if (!getConfiguration('enableTelemetry')){
      return;
    }
    const telemetryEvent: TelemetryEvent = {
      // Event properties are free-form and come from many call sites; the protocol takes kebab-case keys.
      ...kebabKeys(eventData),
      'event-time': new Date().toISOString(),
      'event-name': eventName,
      'editor-type': 'vscode',
      'editor-version': vscode.version,
      'extension-version': this.extension.packageJSON.version,
      'process-platform': process.platform,
      'process-arch': process.arch,
    };
    const userId = telemetryUserId(CsExtensionState.stateProperties);
    if (userId) telemetryEvent['user-id'] = userId;
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
        await vscode.commands.executeCommand('workbench.action.openSettings', getExtensionSettingsFilter());
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
    logOutputChannel.info('Telemetry logger disposed');
    this.telemetryLogger.dispose();
  }
}
