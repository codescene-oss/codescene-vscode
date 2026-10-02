import vscode from 'vscode';
import { ChangeDetail } from '../devtools-api/delta-model';
import { DeltaFunctionInfo } from './delta-function-info';
import { FileWithIssues } from './file-with-issues';

export class DeltaIssue {
  readonly position?: vscode.Position;

  constructor(readonly parent: DeltaFunctionInfo | FileWithIssues, readonly changeDetail: ChangeDetail) {
    if (changeDetail.line) {
      this.position = new vscode.Position(changeDetail.line - 1, 0);
    }
  }

  get parentDocument() {
    return this.parent instanceof DeltaFunctionInfo ? this.parent.parent.document : this.parent.document;
  }
}
