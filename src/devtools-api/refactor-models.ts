/* eslint-disable @typescript-eslint/naming-convention */
import { Range as VscodeRange } from 'vscode';
import { Range } from '../devtools-api/review-model';
import { FixGoalOutcome } from '../refactoring/agent-types';

/**
 * A structure for use in subsequent calls to the refactor endpoint.
 */
export interface FnToRefactor {
  body: string;
  'file-type': string;
  'function-type'?: string;
  /**
   * Function name (for presentation)
   */
  name: string;
  /**
   * Range of the function. Use to keep track of what code to replace in the original file.
   */
  range: Range;
  /**
   * List of refactoring targets (code-smells).
   */
  'refactoring-targets': RefactoringTarget[];

  vscodeRange: VscodeRange; // For internal use, not part of the devtools binary API
}

export interface RefactoringTarget {
  category: string;
  /**
   * Start line for the code smell.
   */
  line: number;
}

export interface RefactorResponse {
  /**
   * Refactored code
   */
  code: string;
  confidence: Confidence;
  /**
   * Optional declarations to be added above the refactored code
   */
  declarations?: string;
  metadata: Metadata;
  /**
   * List of reasons for refactoring failure
   */
  reasons: Reason[];
  'refactoring-properties': RefactoringProperties;
  /**
   * Trace id for the request, use for debugging requests
   */
  'trace-id': string;
  'goal-outcome'?: FixGoalOutcome;
}

export interface Confidence {
  /**
   * Confidence level
   */
  level: number;
  'recommended-action': RecommendedAction;
  /**
   * Header for use when presenting the reason summaries
   */
  'review-header'?: string;
  /**
   * Title for presentation
   */
  title: string;
}

interface RecommendedAction {
  description: string;
  details: string;
}

export interface Metadata {
  'cached?'?: boolean;
}

export interface Reason {
  details?: ReasonDetails[];
  summary: string;
}

export interface ReasonDetails {
  /**
   * 2-tuple pointing to the start-col and end-col of the issue. 0-based.
   */
  columns: number[];
  /**
   * 2-tuple pointing to the start-line and end-line of the issue. 0-based.
   */
  lines: number[];
  message: string;
}

export interface RefactoringProperties {
  'added-code-smells': string[];
  'removed-code-smells': string[];
}
