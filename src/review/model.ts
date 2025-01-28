// This details the structure of the JSON output from the 'cs review' command
/* eslint-disable @typescript-eslint/naming-convention */
export interface ReviewResult {
  score?: number;
  'file-level-code-smells': CodeSmell[];
  'function-level-code-smells': ReviewFunction[];
  'expression-level-code-smells': CodeSmell[];
  'raw-score': string;
}

export interface Range {
  'start-line': number;
  'start-column': number;
  'end-line': number;
  'end-column': number;
}

export interface CodeSmell {
  category: string;
  details: string;
  'highlight-range': Range;
}

export interface ReviewFunction {
  function: string;
  range: Range;
  'code-smells': CodeSmell[];
}
