import { WorkspaceEdit } from './workspace-edit';

export class CodeAction {
  title: string;
  kind?: string;
  diagnostics?: any[];
  edit?: WorkspaceEdit;
  command?: {
    command: string;
    title: string;
    arguments?: any[];
  };
  disabled?: {
    reason: string;
  };

  constructor(title: string, kind?: string) {
    this.title = title;
    this.kind = kind;
  }
}
