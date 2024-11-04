/* eslint-disable @typescript-eslint/naming-convention */
export interface RefactoringSupport {
  'file-types': string[];
  'code-smells': string[];
}

export interface PreFlightResponse {
  supported: RefactoringSupport;
  'max-input-tokens': number;
  'max-input-loc': number;
}

export function isPreFlightResponse(obj: unknown): obj is PreFlightResponse {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    obj.hasOwnProperty('supported') &&
    obj.hasOwnProperty('max-input-tokens') &&
    obj.hasOwnProperty('max-input-loc')
  );
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

export interface RefactorResponse {
  confidence: RefactorConfidence;
  'reasons-with-details': ReasonsWithDetails[];
  'refactoring-properties': RefactorProperties;
  code: string;
}

export interface AceCredits {
  resetTime?: Date;
  limit: number;
  used: number;
}
