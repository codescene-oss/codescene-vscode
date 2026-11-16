import * as vscode from 'vscode';
import { logOutputChannel } from './log';

function getFirstNonBlankString(config: vscode.WorkspaceConfiguration, section: string, defaultValue: string): string {
  // This fallback logic prevents a bad behavior where a blank (perhaps even unset) Workspace value
  // can take priority over a non-blank User value.
  const inspected = config.inspect<string>(section);
  const sources = [
    config.get<string>(section, defaultValue), // First priority: default VS Code logic
    inspected?.workspaceValue,                 // Second priority: Workspace
    inspected?.globalValue,                    // Last priority: User
  ];

  const trimmed = sources.map((value) => (typeof value === 'string' ? value.trim() : ''));
  return trimmed.find(Boolean) ?? defaultValue;
}

export function getConfiguration<T>(section: string, defaultValue?: T): T | undefined {
  const config = vscode.workspace.getConfiguration('codescene');

  if (defaultValue === '') { // If the requested config is of type String, we can apply the following fallback logic:
    return getFirstNonBlankString(config, section, defaultValue as string) as T;
  }

  if (!defaultValue) {
    return config.get<T>(section);
  }

  return config.get<T>(section, defaultValue);
}

export function setConfiguration(section: string, value: any) {
  const codesceneConfig = vscode.workspace.getConfiguration('codescene');
  codesceneConfig.update(section, value).then(
    () => {},
    (err) => {
      logOutputChannel.error(`setConfiguration(${section}) failed: ${err}`);
    }
  );
}

export function onDidChangeConfiguration(
  section: string,
  listener: (e: { event: vscode.ConfigurationChangeEvent; value: any }) => any
) {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('codescene.' + section)) {
      listener({ event: e, value: getConfiguration(section) });
    }
  });
}

export function reviewCodeLensesEnabled() {
  return getConfiguration<boolean>('enableReviewCodeLenses');
}

export function toggleReviewCodeLenses() {
  const state = reviewCodeLensesEnabled();
  setConfiguration('enableReviewCodeLenses', !state);
}

export function getAuthToken() {
  return getConfiguration<string>('authToken', '');
}

const DEFAULT_AGENT_MODEL = 'anthropic/claude-sonnet-5-5';

const MODEL_BY_PROVIDER_OPTIONS: Array<{ options: string[]; model: string }> = [
  { options: ['anthropic:api-key'], model: DEFAULT_AGENT_MODEL },
  { options: ['openai:api-key'], model: 'openai/gpt-6.1-sol' },
  { options: ['google:api-key'], model: 'google/gemini-4-carbon' },
  {
    options: ['amazon-bedrock:profile', 'amazon-bedrock:region'],
    model: 'amazon-bedrock/eu.anthropic.claude-sonnet-5-5',
  },
];

function inferModelFromProviderOptions(opts: Record<string, string>): string | undefined {
  return MODEL_BY_PROVIDER_OPTIONS.find(({ options }) => options.some((option) => opts[option]))?.model;
}

export function getAgentModel(providerOptions: Record<string, string> = getProviderOptions()): string {
  const override = getConfiguration<string>('agentModelOverride', '')?.trim();
  if (override) {
    return override;
  }

  const configured = getConfiguration<string>('agentModel', '');
  const inferred = inferModelFromProviderOptions(providerOptions);

  if (configured && configured !== DEFAULT_AGENT_MODEL) {
    return configured;
  }

  if (inferred) {
    return inferred;
  }

  return configured || DEFAULT_AGENT_MODEL;
}

export function getProviderOptions(): Record<string, string> {
  return getConfiguration<Record<string, string>>('providerOptions') ?? {};
}

export function automaticAnalysisEnabled() {
  return getConfiguration<boolean>('enableAutomaticAnalysis', true) !== false;
}

export function setAutomaticAnalysisEnabled(enabled: boolean) {
  const codesceneConfig = vscode.workspace.getConfiguration('codescene');
  const inspected = codesceneConfig.inspect<boolean>('enableAutomaticAnalysis');
  if (inspected?.workspaceValue !== undefined) {
    logOutputChannel.warn(
      'codescene.enableAutomaticAnalysis has a workspace value; clearing it so the user setting takes effect'
    );
    void codesceneConfig.update('enableAutomaticAnalysis', undefined, vscode.ConfigurationTarget.Workspace).then(
      () => {},
      (err) => {
        logOutputChannel.error(`clearing workspace enableAutomaticAnalysis failed: ${err}`);
      }
    );
  }
  void codesceneConfig.update('enableAutomaticAnalysis', enabled, vscode.ConfigurationTarget.Global).then(
    () => {},
    (err) => {
      logOutputChannel.error(`setConfiguration(enableAutomaticAnalysis) failed: ${err}`);
    }
  );
}
