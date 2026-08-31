import { getAgentModel, getAwsProfile, getAwsRegion, getAuthToken } from '../configuration';
import { AgentConfig, OpencodeConfig } from './agent-types';

export { getAgentModel } from '../configuration';

export function buildAgentConfigWithToken(token: string): AgentConfig {
  if (!token) {
    throw new Error('No authentication token available for agent');
  }

  const model = getAgentModel() ?? 'amazon-bedrock/eu.anthropic.claude-sonnet-4-6';
  const awsProfile = getAwsProfile() ?? '';
  const awsRegion = getAwsRegion() ?? 'eu-west-1';

  const opencodeConfig: OpencodeConfig = {
    model,
  };

  if (model.startsWith('amazon-bedrock/')) {
    if (awsProfile) {
      opencodeConfig.aws_profile = awsProfile;
    }
    opencodeConfig.aws_region = awsRegion;
  }

  return {
    codescene_access_token: token,
    plugins: ['render-code-fix-reporter'],
    opencode_config: opencodeConfig,
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
