// This module provides a global interface to the CodeScene telemetry singleton.
import * as vscode from 'vscode';
import { v4 as uuid } from 'uuid';
import { getConfiguration } from './configuration';
import { CsExtensionState, type CsStateProperties } from './cs-extension-state';
import { getExtensionSettingsFilter } from './extension-id';
import { DevtoolsAPI } from './devtools-api';
import { TelemetryEvent } from './devtools-api/telemetry-model';
import { logOutputChannel } from './log';
import { serializeError } from './utils';
import { kebabKeys } from './utils/kebab-keys';
import { RoutingGate } from './telemetry-routing-gate';

function telemetryUserId({ auth, legacySession }: CsStateProperties): string | undefined {
  return auth.status?.user?.id ?? legacySession?.userId;
}

function repositoryPathsOf(value: unknown): string[] {
  const paths = value instanceof vscode.TelemetryTrustedValue ? value.value : value;
  if (paths === undefined) return vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  if (typeof paths === 'string') return [paths];
  return Array.isArray(paths) ? paths : [];
}

interface QueuedEvent {
  name: string;
  data: any;
  eventTime: string;
}

export default class Telemetry {
  private static _instance?: Telemetry;
  private static sessionId?: string;
  private static gate?: RoutingGate<QueuedEvent>;
  private static inFlight = new Set<Promise<any>>();

  private static eventPrefix = 'vscode';
  private telemetryLogger: vscode.TelemetryLogger;

  constructor(private extension: vscode.Extension<any>) {
    const sender: vscode.TelemetrySender = {
      sendEventData: (eventName, eventData) => {
        // The telemetry-sender apparently adds the extension id to the event name - replace it manually here to keep it simple for Amplitude users
        const evtName = eventName.replace(extension.id, Telemetry.eventPrefix);
        const eventTime = new Date().toISOString();

        if (Telemetry.gate) {
          Telemetry.gate.submit({ name: evtName, data: eventData, eventTime });
        } else {
          void this.postTelemetry(evtName, eventData, eventTime);
        }
      },
      sendErrorData: () => {},
    };

    this.telemetryLogger = vscode.env.createTelemetryLogger(sender, { ignoreUnhandledErrors: true });
  }

  static async init(context: vscode.ExtensionContext): Promise<void> {
    try {
      this.sessionId = uuid();
      this.gate?.close();
      this.gate = Telemetry.createGate();
      this.gate.hold();

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
      this._instance = undefined;
    }
  }

  static logUsage(eventName: string, eventData?: any) {
    if (!Telemetry._instance) {
      return;
    }
    Telemetry._instance.telemetryLogger.logUsage(eventName, eventData);
  }

  static get routing() {
    return {
      hold: () => Telemetry.gate?.hold() ?? 0,
      ready: (generation: number) => Telemetry.gate?.ready(generation),
      close: () => Telemetry.gate?.close(),
    };
  }

  static async endSession(timeoutMs = 3000): Promise<void> {
    if (!Telemetry._instance) {
      Telemetry.routing.close();
      return;
    }

    const willLog = getConfiguration('enableTelemetry');
    if (!willLog && Telemetry.inFlight.size === 0) {
      Telemetry.routing.close();
      return;
    }

    if (willLog) {
      Telemetry.logUsage('session/ended');
    }

    Telemetry.routing.close();

    if (Telemetry.inFlight.size > 0) {
      const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      await Promise.race([Promise.allSettled([...Telemetry.inFlight]), delay(timeoutMs)]);
    }
  }

  static resetForTests(boundMs?: number) {
    Telemetry.gate?.close();
    Telemetry.gate = Telemetry.createGate(boundMs);
    Telemetry.inFlight.clear();
  }

  private static createGate(boundMs = 15000): RoutingGate<QueuedEvent> {
    return new RoutingGate<QueuedEvent>({
      boundMs,
      maxHeld: 100,
      isFirst: (item) => item.name.endsWith('/session/started'),
      send: (item) => {
        void Telemetry._instance?.postTelemetry(item.name, item.data, item.eventTime);
      },
    });
  }

  private async postTelemetry(eventName: string, eventData: any, eventTime?: string) {
    const promise = (async () => {
      try {
        await this.postTelemetryImpl(eventName, eventData, eventTime);
      } catch (e) {
        logOutputChannel.debug(JSON.stringify(e instanceof Error ? serializeError(e) : e));
      }
    })();

    Telemetry.inFlight.add(promise);
    void promise.finally(() => Telemetry.inFlight.delete(promise));
    return promise;
  }

  private async postTelemetryImpl(eventName: string, eventData: any, eventTime?: string) {
    if (!getConfiguration('enableTelemetry')){
      return;
    }

    const { 'repository-paths': repositoryPathsValue, ...otherData } = eventData ?? {};
    const repositoryPaths = repositoryPathsOf(repositoryPathsValue);

    const telemetryEvent: TelemetryEvent = {
      // Event properties are free-form and come from many call sites; the protocol takes kebab-case keys.
      ...kebabKeys(otherData),
      'event-time': eventTime ?? new Date().toISOString(),
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
    if (Telemetry.sessionId) telemetryEvent['session-id'] = Telemetry.sessionId;
    if (repositoryPaths.length > 0) telemetryEvent['repository-paths'] = repositoryPaths;
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
