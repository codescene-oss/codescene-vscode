import { FnToRefactor } from './refactor-models';

/* eslint-disable @typescript-eslint/naming-convention */
export interface Delta {
  'file-level-findings': ChangeDetail[];
  /**
   * Function level findings also include expression level smells
   * (i.e. Complex Conditionals). For expression level smells the 'function' range might only
   * correspond to the highlighting
   * range - unless the function also contains other smells.
   */
  'function-level-findings': FunctionFinding[];
  /**
   * If file is still present, the new score for the file
   */
  'new-score'?: number;
  /**
   * If the file was not recently created, the old file score
   */
  'old-score'?: number;
  /**
   * Represents the change in score for this Delta. An empty old- or new score is assumed to
   * be 10.0 when comparing.
   */
  'score-change': number;
}

export interface ChangeDetail {
  /**
   * Code smell category, for example Complex Method
   */
  category: string;
  'change-type': ChangeType;
  /**
   * Detailed description about what caused the code health to go down.
   */
  description: string;
  /**
   * Line number of this change. 1-indexed. Note that for 'fixed'
   * changes, the line only indicates where the issue was before the change.
   */
  line?: number;
}

export enum ChangeType {
  Degraded = 'degraded',
  Fixed = 'fixed',
  Improved = 'improved',
  Introduced = 'introduced',
}

export const sortOrder: { [key in ChangeType]: number } = {
  introduced: 1,
  degraded: 2,
  fixed: 5,
  improved: 4,
};

export interface FunctionFinding {
  'change-details': ChangeDetail[];
  function: Function;

  /* Present if the function finding is deemed refactorable. See Analyser.addRefactorableFunctionsToDeltaResult() */
  refactorableFn?: FnToRefactor;
}

export interface Function {
  /**
   * Name of function
   */
  name: string;
  /**
   * Full range of the function.
   */
  range?: Range;
}

/**
 * Full range of the function.
 */
export interface Range {
  /**
   * Range end column. 1-indexed.
   */
  'end-column': number;
  /**
   * Range end line. 1-indexed.
   */
  'end-line': number;
  /**
   * Range start column. 1-indexed.
   */
  'start-column': number;
  /**
   * Range start line. 1-indexed.
   */
  'start-line': number;
}
