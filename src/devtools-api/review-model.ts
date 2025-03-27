/* eslint-disable @typescript-eslint/naming-convention */
export interface Review {
  'file-level-code-smells': CodeSmell[];
  'function-level-code-smells': Function[];
  /**
   * Base64 encoded review data used by the delta analysis.
   */
  'raw-score': string;
  /**
   * If file is scorable, this will be a number between 1.0 and 10.0
   */
  score?: number;
}

export interface CodeSmell {
  /**
   * Name of codesmell.
   */
  category: string;
  /**
   * Details about codesmell, for example nesting depth.
   */
  details: string;
  /**
   * Range for highlighting this code smell.
   */
  'highlight-range': Range;
}

/**
 * Range for highlighting this code smell.
 *
 * Range within the code where the smell occurs.
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

export interface Function {
  'code-smells': CodeSmell[];
  /**
   * The name of the function which has codesmell(s).
   */
  function: string;
  /**
   * Range within the code where the smell occurs.
   */
  range: Range;
}
