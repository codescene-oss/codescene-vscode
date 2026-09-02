export interface AgentInputContext {
  '@vocab': string;
}

export interface AgentInput {
  '@context': AgentInputContext;
  task_id: string;
  file: string;
  line: number;
  smell: string;
}

export interface AgentOutputContext {
  '@vocab': string;
}

export type FixResult = 'fix_proposed' | 'unable_to_fix' | 'needs_human_review';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type ChangeType = 'partial' | 'whole_file';

export interface AgentReplacement {
  search: string;
  replace: string;
}

export interface AgentChange {
  file: string;
  change_type: ChangeType;
  description: string;
  replacements?: AgentReplacement[];
  whole_file_content?: string;
}

export interface AgentOutput {
  '@context': AgentOutputContext;
  schema_version: string;
  task_id: string;
  fix_result: FixResult;
  confidence: ConfidenceLevel;
  summary: string;
  reasoning: string;
  changes: AgentChange[];
  generated_at: string;
}

export interface AgentConfig {
  codescene_access_token: string;
  plugins: string[];
  opencode_config?: {
    provider: {
      'amazon-bedrock': {
        options: {
          profile: string;
          region: string;
        };
      };
    };
  };
}
