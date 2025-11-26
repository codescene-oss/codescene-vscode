export class DiagnosticStub {
  range: any;
  message: string;
  severity: any;
  source?: string;
  code?: any;

  constructor(range: any, message: string, severity?: any) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}
