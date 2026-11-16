export interface RefactorResponse {
  code: string;
  declarations?: string; // C++ specific
  metadata: Metadata;
  reasons: Reason[];
  confidence: Confidence;
  'trace-id': string;
  'refactoring-properties': RefactoringProperties;
}

export interface Metadata {
  'cached?'?: boolean;
}

export interface Reason {
  summary: string;
  details: ReasonDetails[];
}

export interface ReasonDetails {
  message: string;
  lines: number[];
  columns: number[];
}

export interface Confidence {
  title: string;
  'review-header': string;
  'recommended-action': RecommendedAction;

  /**
   * Low = 0
   * MediumLow = 1
   * Medium = 2
   * MediumHigh = 3
   * High = 4
   */
  level: number;
}

export interface RecommendedAction {
  details: string;
  description: string;
}

export interface RefactoringProperties {
  'added-code-smells': string[];
  'removed-code-smells': string[];
}
