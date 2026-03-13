export class SelectionStub {
  constructor(public anchor: any, public active: any) {
    this.start = anchor;
    this.end = active;
  }
  start: any;
  end: any;
}
