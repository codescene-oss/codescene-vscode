import { EventEmitter } from 'vscode';
import type { AuthSettings, AuthSettingsSnapshot } from '../../auth/auth-settings';

export class FakeAuthSettings implements AuthSettings {
  readonly tokenWrites: Array<string | undefined> = [];
  private readonly emitter = new EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private values: AuthSettingsSnapshot = { signInEnabled: true, serverUrl: '', accessToken: '' }) {}

  read(): AuthSettingsSnapshot {
    return { ...this.values };
  }

  update(values: Partial<AuthSettingsSnapshot>): void {
    this.values = { ...this.values, ...values };
    this.emitter.fire();
  }

  async setAccessToken(token: string | undefined): Promise<void> {
    this.tokenWrites.push(token);
    this.update({ accessToken: token ?? '' });
  }
}
