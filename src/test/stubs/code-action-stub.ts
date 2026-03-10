export class CodeActionStub {
  title: string;
  kind?: string;
  diagnostics?: any[];
  edit?: any;
  command?: any;
  disabled?: any;
  constructor(title: string, kind?: string) {
    this.title = title;
    this.kind = kind;
  }
}
