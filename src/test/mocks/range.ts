import { Position } from './position';

export class Range {
  constructor(
    public start: Position,
    public end: Position
  ) {}

  contains(positionOrRange: Position | Range): boolean {
    if (positionOrRange instanceof Position) {
      const pos = positionOrRange;
      return pos.line >= this.start.line &&
             pos.line <= this.end.line &&
             (pos.line !== this.start.line || pos.character >= this.start.character) &&
             (pos.line !== this.end.line || pos.character <= this.end.character);
    }
    const range = positionOrRange;
    return this.contains(range.start) && this.contains(range.end);
  }
}
