/* eslint-disable @typescript-eslint/naming-convention */
export type PreFlightResponse = {
  version: number;
  'file-types': string[];
  'language-common': RefactorSupport;
  'language-specific'?: Record<string, Partial<RefactorSupport>>;
};

export type RefactorSupport = {
  'max-input-loc': number;
  'code-smells': string[];
};

interface Review {
  category: string; // Type of issue
  'start-line': number; // Start line of the issue relative to the source snippet
  'end-line'?: number; // Currently optional line of the issue relative to the source snippet
}

interface SourceSnippet {
  'file-type': string; // file extension
  'function-type': string; // Function type (specified by cli tool)
  body: string; // Function body
}

export interface RefactorRequest {
  review: Review[];
  'source-snippet': SourceSnippet;
  'device-id': string;
}

export interface RefactorConfidence {
  description: string;
  title: string;
  level: number;
  'recommended-action': { description: string; details: string };
  'review-header'?: string;
}

interface RefactorProperties {
  'added-code-smells': string[];
  'removed-code-smells': string[];
}

interface ReasonDetails {
  message: string;
  lines: number[];
  columns: number[];
}

export interface ReasonsWithDetails {
  summary: string;
  details?: ReasonDetails[];
}

interface Metadata {
  'cached?'?: boolean;
}
export interface RefactorResponse {
  confidence: RefactorConfidence;
  'reasons-with-details': ReasonsWithDetails[];
  'refactoring-properties': RefactorProperties;
  code: string;
  metadata: Metadata;
}

export interface AceCredits {
  resetTime?: Date;
  limit: number;
  used: number;
}
