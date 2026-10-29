import vscode from 'vscode';
import { DeltaFunctionInfo } from './delta-function-info';
import { DeltaIssue } from './delta-issue';
import { sortFnInfo } from './sort-fn-info';
import { Delta } from '../devtools-api/delta-model';

export class FileWithIssues {
  public functionLevelIssues: DeltaFunctionInfo[] = [];

  constructor(public deltaForFile: Delta, public document: vscode.TextDocument) {
    this.update(deltaForFile, document);
  }

  get nIssues() {
    return this.functionLevelIssues.length;
  }

  get scoreChange() {
    return this.deltaForFile['score-change'];
  }

  update(deltaForFile: Delta, document: vscode.TextDocument) {
    this.deltaForFile = deltaForFile;
    this.document = document;
    this.functionLevelIssues = deltaForFile['function-level-findings'].map((finding) => {
      const functionInfo = new DeltaFunctionInfo(this, finding.function, finding.refactorableFn);
      finding['change-details'].forEach((changeDetail) =>
        functionInfo.children.push(new DeltaIssue(functionInfo, changeDetail))
      );
      return functionInfo;
    });
    this.sortAndSetChildren();
  }

  sortAndSetChildren() {
    this.functionLevelIssues.sort(sortFnInfo);
  }
}
