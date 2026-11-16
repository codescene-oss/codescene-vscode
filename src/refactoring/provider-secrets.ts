import vscode from 'vscode';
import { getProviderOptions } from '../configuration';

export const PROVIDER_API_KEYS = [
  { option: 'anthropic:api-key', label: 'Anthropic' },
  { option: 'openai:api-key', label: 'OpenAI' },
  { option: 'google:api-key', label: 'Google (Gemini)' },
];

let secretStorage: vscode.SecretStorage | undefined;

export function initProviderSecrets(secrets: vscode.SecretStorage): void {
  secretStorage = secrets;
}

function secretKey(option: string): string {
  return `codescene.agent.${option}`;
}

async function storedKey(option: string): Promise<string | undefined> {
  return secretStorage?.get(secretKey(option));
}

export async function getAgentProviderOptions(): Promise<Record<string, string>> {
  const options = { ...getProviderOptions() };
  for (const { option } of PROVIDER_API_KEYS) {
    const stored = await storedKey(option);
    if (stored) options[option] = stored;
  }
  return options;
}

export async function storeProviderApiKey(option: string, value: string): Promise<void> {
  const key = value.trim();
  if (key) {
    await secretStorage?.store(secretKey(option), key);
  } else {
    await secretStorage?.delete(secretKey(option));
  }
}

function withoutApiKeys(options: Record<string, string>): Record<string, string> | undefined {
  const remaining = Object.entries(options).filter(([option]) => !PROVIDER_API_KEYS.some((p) => p.option === option));
  return remaining.length > 0 ? Object.fromEntries(remaining) : undefined;
}

async function moveKeys(options: Record<string, string>): Promise<number> {
  const keys = PROVIDER_API_KEYS.filter(({ option }) => options[option]?.trim());
  for (const { option } of keys) {
    if (!(await storedKey(option))) await storeProviderApiKey(option, options[option]);
  }
  return keys.length;
}

export async function migrateProviderApiKeysFromSettings(): Promise<number> {
  const config = vscode.workspace.getConfiguration('codescene');
  const inspected = config.inspect<Record<string, string>>('providerOptions');
  const targets = [
    { options: inspected?.workspaceValue, target: vscode.ConfigurationTarget.Workspace },
    { options: inspected?.globalValue, target: vscode.ConfigurationTarget.Global },
  ];

  let moved = 0;
  for (const { options, target } of targets) {
    if (!options) continue;
    const count = await moveKeys(options);
    if (count === 0) continue;
    await config.update('providerOptions', withoutApiKeys(options), target);
    moved += count;
  }
  return moved;
}

export async function promptForProviderApiKey(): Promise<void> {
  const items = await Promise.all(
    PROVIDER_API_KEYS.map(async ({ option, label }) => ({
      label,
      option,
      description: (await storedKey(option)) ? 'Key stored' : undefined,
    }))
  );
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Refactoring Agent API key',
    placeHolder: 'Choose the provider to set the API key for',
  });
  if (!picked) return;

  const value = await vscode.window.showInputBox({
    title: `${picked.label} API key`,
    prompt: 'The key is kept in VS Code secure storage. Leave empty to remove the stored key.',
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined) return;

  await storeProviderApiKey(picked.option, value);
  void vscode.window.showInformationMessage(
    value.trim() ? `Stored the ${picked.label} API key securely.` : `Removed the ${picked.label} API key.`
  );
}
