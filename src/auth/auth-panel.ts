import vscode from 'vscode';
import { devmode, featureFlags, ideType, initBaseContent, updateRendererMessage } from '../centralized-webview-framework/cwf-html-utils';
import type { AuthContextViewProps } from '../centralized-webview-framework/types';
import type { MessageToIDEType } from '../centralized-webview-framework/types/messages';
import { commonResourceRoots } from '../webview-utils';
import { cwfAuthActive, onDidChangeCwfAuth } from './cwf-auth';

type MessageHandler = (message: MessageToIDEType) => Promise<unknown>;

export const AUTH_PANEL_TITLE = 'CodeScene account';

export function authViewProps(): AuthContextViewProps {
  return { ideType, view: 'auth', devmode, pro: true, featureFlags: [...featureFlags] };
}

export class AuthPanel implements vscode.Disposable {
  static readonly viewType = 'codescene-auth-tab';
  private static current: AuthPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private initialized = false;

  static show(onMessage: MessageHandler): void {
    if (AuthPanel.current) {
      AuthPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(AuthPanel.viewType, AUTH_PANEL_TITLE, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: commonResourceRoots(),
    });
    AuthPanel.current = new AuthPanel(panel, onMessage);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly onMessage: MessageHandler
  ) {
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage((message: MessageToIDEType) => this.handleMessage(message), null, this.disposables);
    onDidChangeCwfAuth(() => this.handleAuthChange(), null, this.disposables);
    panel.webview.html = initBaseContent(panel.webview, authViewProps());
  }

  dispose(): void {
    AuthPanel.current = undefined;
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;
  }

  private async handleMessage(message: MessageToIDEType): Promise<void> {
    if (message.messageType !== 'init') {
      await this.onMessage(message);
      return;
    }
    this.initialized = true;
    await this.render();
  }

  private handleAuthChange(): void {
    if (!cwfAuthActive()) {
      this.panel.dispose();
      return;
    }
    void this.render();
  }

  private async render(): Promise<void> {
    if (this.initialized) await this.panel.webview.postMessage(updateRendererMessage(authViewProps()));
  }
}
