import { Range, TextDocument } from 'vscode';
import { DeltaForFile } from '../code-health-monitor/model';
import { DevtoolsAPI } from '../devtools-interop/api';
import { CodeSmell, Range as ReviewRange } from '../review/model';
import { PreFlightResponse } from './model';

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

export class RefactoringCapabilities {
  constructor(private preFlight: PreFlightResponse, private devtoolsAPI: DevtoolsAPI) {}

  async getFnsToRefactorFromCodeSmells(document: TextDocument, codeSmells: CodeSmell[]) {
    return await this.devtoolsAPI.fnsToRefactorFromCodeSmells(document, codeSmells, this.preFlight);
  }

  async getFnsToRefactorFromDelta(document: TextDocument, deltaResult: DeltaForFile) {
    return await this.devtoolsAPI.fnsToRefactorFromDelta(document, deltaResult, this.preFlight);
  }
}
