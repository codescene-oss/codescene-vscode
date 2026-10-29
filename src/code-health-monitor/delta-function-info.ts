import vscode from 'vscode';
import { FnToRefactor } from '../devtools-api/refactor-models';
import { vscodeRange } from '../review/utils';
import { isDefined } from '../utils';
import { FileWithIssues } from './file-with-issues';
import { DeltaIssue } from './delta-issue';
import { Function } from '../devtools-api/delta-model';

export class DeltaFunctionInfo {
  readonly fnName: string;
  readonly range?: vscode.Range;
  readonly children: Array<DeltaIssue> = [];

  constructor(readonly parent: FileWithIssues, fnMeta: Function, public fnToRefactor?: FnToRefactor) {
    this.fnName = fnMeta.name;
    this.range = vscodeRange(fnMeta.range);
  }

  public get isRefactoringSupported() {
    return isDefined(this.fnToRefactor);
  }
}
