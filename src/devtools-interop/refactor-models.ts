/* eslint-disable @typescript-eslint/naming-convention */
import { Range as ReviewRange } from '../review/model';
import { Range } from 'vscode';

export interface CreditsInfoError {
  'credits-info': CreditsInfo;
  message: string;
  [property: string]: any;
}

export interface CreditsInfo {
  limit: number;
  /**
   * Credit reset date in ISO-8601 format
   */
  reset?: string;
  used: number;
  [property: string]: any;
}

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

export interface FnToRefactor {
  name: string;
  range: ReviewRange;
  body: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'file-type': string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'function-type': string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'refactoring-targets': RefactoringTarget[];

  vscodeRange: Range; // For internal use, not part of the devtools binary API
}

export interface RefactoringTarget {
  line: number; // 1-indexed line numbers (from Devtools API)
  category: string;
}

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
