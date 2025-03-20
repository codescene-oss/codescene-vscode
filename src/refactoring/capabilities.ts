import { TextDocument } from 'vscode';
import { DeltaForFile } from '../code-health-monitor/model';
import { DevtoolsAPI } from '../devtools-interop/api';
import { CodeSmell } from '../review/model';

export class RefactoringCapabilities {
  constructor(private devtoolsAPI: DevtoolsAPI) {}

  async getFnsToRefactorFromCodeSmells(document: TextDocument, codeSmells: CodeSmell[]) {
    return await this.devtoolsAPI.fnsToRefactorFromCodeSmells(document, codeSmells);
  }

  async getFnsToRefactorFromDelta(document: TextDocument, deltaResult: DeltaForFile) {
    return await this.devtoolsAPI.fnsToRefactorFromDelta(document, deltaResult);
  }
}
