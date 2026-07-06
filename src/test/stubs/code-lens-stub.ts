import { RangeStub } from './range-stub';

export class CodeLensStub {
  range: any;
  command?: any;
  isResolved: boolean;

  constructor(range: any, command?: any) {
    this.range = range || new RangeStub(0, 0, 0, 0);
    this.command = command;
    this.isResolved = command !== undefined;
  }
}
