import { getAuthToken } from '../configuration';
import { AgentConfig } from './agent-types';

export function buildAgentConfigWithToken(token: string): AgentConfig {
  if (!token) {
    throw new Error('No authentication token available for agent');
  }

  return {
    codescene_access_token: token,
    plugins: ['render-code-fix-reporter'],
    opencode_config: {
      provider: {
        'amazon-bedrock': {
          options: {
            profile: 'codescene-dev',
            region: 'eu-west-1',
          },
        },
      },
    },
  };
}

export function buildAgentConfig(): AgentConfig {
  const token = getAuthToken();
  if (!token) {
    throw new Error('No authentication token available for agent');
  }
  return buildAgentConfigWithToken(token);
}

export function buildAgentConfigJson(): string {
  return JSON.stringify(buildAgentConfig());
}
