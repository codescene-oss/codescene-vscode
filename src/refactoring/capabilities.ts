import { TextDocument } from 'vscode';
import { DeltaForFile } from '../code-health-monitor/model';
import { DevtoolsAPI } from '../devtools-api';
import { CodeSmell } from '../review/model';

export class RefactoringCapabilities {
  constructor() {}

  async getFnsToRefactorFromCodeSmells(document: TextDocument, codeSmells: CodeSmell[]) {
    return await DevtoolsAPI.fnsToRefactorFromCodeSmells(document, codeSmells);
  }

  async getFnsToRefactorFromDelta(document: TextDocument, deltaResult: DeltaForFile) {
    return await DevtoolsAPI.fnsToRefactorFromDelta(document, deltaResult);
  }
}
