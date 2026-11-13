import type { AuthServer } from '../centralized-webview-framework/types/auth';
import { getProviderOptions } from '../configuration';
import { AgentConfig, BedrockOpencodeProvider, ProviderCredentials } from './agent-types';

export interface AgentSkill {
  name: string;
  plugin: string;
  inputFile: string;
  outputFile: string;
}

export const RENDER_CODE_FIX_SKILL: AgentSkill = {
  name: 'render-code-fix',
  plugin: 'render-code-fix-reporter',
  inputFile: 'render-code-fix-input.json',
  outputFile: 'render-code-fix-output.json',
};

export const FIX_GOAL_SKILL: AgentSkill = {
  name: 'fix-goal',
  plugin: 'fix-goal-reporter',
  inputFile: 'fix-goal-input.json',
  outputFile: 'fix-goal-output.json',
};

function hasAnyApiKey(anthropicApiKey: string | undefined, openaiApiKey: string | undefined, googleApiKey: string | undefined): boolean {
  return Boolean(anthropicApiKey || openaiApiKey || googleApiKey);
}

export function buildProviderCredentials(opts: Record<string, string>): ProviderCredentials | undefined {
  const anthropicApiKey = opts['anthropic:api-key'];
  const openaiApiKey = opts['openai:api-key'];
  const googleApiKey = opts['google:api-key'];

  if (!hasAnyApiKey(anthropicApiKey, openaiApiKey, googleApiKey)) {
    return undefined;
  }

  const credentials: ProviderCredentials = {};

  if (anthropicApiKey) {
    credentials.anthropic_api_key = anthropicApiKey;
  }

  if (openaiApiKey) {
    credentials.openai_api_key = openaiApiKey;
  }

  if (googleApiKey) {
    credentials.google_api_key = googleApiKey;
  }

  return credentials;
}

export function buildOpencodeConfig(opts: Record<string, string>): AgentConfig['opencode_config'] | undefined {
  const bedrockProfile = opts['amazon-bedrock:profile'];
  const bedrockRegion = opts['amazon-bedrock:region'];

  if (!bedrockProfile && !bedrockRegion) {
    return undefined;
  }

  const provider: BedrockOpencodeProvider = {
    'amazon-bedrock': {
      options: {
        ...(bedrockProfile && { profile: bedrockProfile }),
        ...(bedrockRegion && { region: bedrockRegion }),
      },
    },
  };

  return { provider };
}

export function buildAgentConfigWithToken(
  token: string | undefined,
  plugin: string | undefined,
  ioDir?: string,
  server?: AuthServer | null
): AgentConfig {
  const providerOpts = getProviderOptions();
  const providerCredentials = buildProviderCredentials(providerOpts);
  const opencodeConfig = buildOpencodeConfig(providerOpts);

  return {
    codescene_access_token: token ?? '',
    ...(server?.onprem && { codescene_onprem_url: server.url }),
    plugins: plugin ? [plugin] : [],
    tracking: { environment: 'codescene-vscode' },
    ...(ioDir && { io_json_dir: ioDir }),
    ...(providerCredentials && { provider: providerCredentials }),
    ...(opencodeConfig && { opencode_config: opencodeConfig }),
  };
}
