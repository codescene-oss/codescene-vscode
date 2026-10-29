// This module provides a global interface to the CodeScene output channel.
import * as vscode from 'vscode';

const logOutputChannel = vscode.window.createOutputChannel('CodeScene Log', { log: true });

export const LOG_PATH_LIST_LIMIT = 20;

export function formatCappedList(items: readonly string[], limit = LOG_PATH_LIST_LIMIT): string {
  if (items.length === 0) return '(none)';
  if (items.length <= limit) return items.join(', ');
  return `${items.slice(0, limit).join(', ')} omitted=${items.length - limit}`;
}

export function formatLogFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatLogValue(value)}`)
    .join(' ');
}

function formatLogValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.includes(' ') ? JSON.stringify(value) : value;
  if (Array.isArray(value)) return formatCappedList(value.map((item) => String(item)));
  return String(value);
}

export function registerShowLogCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('codescene.showLogOutput', () => {
      logOutputChannel.show();
    })
  );
}

export function deactivate() {
  logOutputChannel.dispose();
}

export { logOutputChannel };
