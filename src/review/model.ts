// This details the structure of the JSON output from the 'cs review' command
export interface ReviewResult {
    score: number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'file-level-code-smells': CodeSmell[];
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'function-level-code-smells': ReviewFunction[];
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'expression-level-code-smells': CodeSmell[];
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'raw-score': string;
  }

  export interface Range {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'start-line': number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'start-column': number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'end-line': number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'end-column': number;
  }

  export interface CodeSmell { 
    category: string;
    details: string;
    range: Range;
  }
  
  export interface ReviewFunction {
    function: string;
    range: Range;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'code-smells': CodeSmell[];
  }
  
