import * as vscode from 'vscode';
import { CodeSmell } from '../devtools-api/review-model';

export class CsCodeLens extends vscode.CodeLens {
  constructor(
    range: vscode.Range,
    public readonly document: vscode.TextDocument,
    public readonly codeSmell: CodeSmell,
    public readonly cacheKey: string
  ) {
    super(range);
  }
}
