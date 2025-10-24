export interface ReviewResult {
  'file-level-code-smells': FileSmell[];
  'function-level-code-smells': FunctionSmell[];
  'raw-score': string;
  score: number;
}

export interface FileSmell {
  category: string;
  'highlight-range': HighlightRange;
  details: string;
}

export interface HighlightRange {
  'start-line': number;
  'start-column': number;
  'end-line': number;
  'end-column': number;
}

export interface FunctionSmell {
  function: string;
  range: Range;
  'code-smells': CodeSmell[];
}

export interface Range {
  'start-line': number;
  'start-column': number;
  'end-line': number;
  'end-column': number;
}

export interface RangeCamel {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface CodeSmell {
  category: string;
  'highlight-range': HighlightRange;
  details: string;
}

export interface FunctionToRefactor {
  name: string;
  body: string;
  'function-type': string;
  'file-type': string;
  range: Range;
  'refactoring-targets': RefactoringTarget[];
}

export interface RefactoringTarget {
  category: string;
  line: number;
}

export interface DeltaForFile {
  'old-score'?: number;
  'new-score'?: number;
  'score-change': number;
  'file-level-findings': ChangeDetail[];
  'function-level-findings': FunctionFinding[];
}

export interface FunctionFinding {
  function: FunctionInfo;
  'change-details': ChangeDetail[];
  'refactorable-fn'?: FunctionToRefactor | undefined;
}

export type ChangeType = 'introduced' | 'fixed' | 'improved' | 'degraded' | 'unchanged';

export interface ChangeDetail {
  'change-type': ChangeType;
  category: string;
  description: string;
  line?: number;
}

export interface FunctionInfo {
  name?: string;
  range?: Range;
}
export interface FunctionInfoExternal {
  name: string;
  range?: RangeCamel;
}
