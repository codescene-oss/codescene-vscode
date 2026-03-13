import { Position } from './position';
import { Selection } from './selection';

export class MockEditor {
  public selection: Selection;

  constructor(public document: any) {
    this.selection = new Selection(
      new Position(0, 0),
      new Position(0, 0)
    );
  }
}
