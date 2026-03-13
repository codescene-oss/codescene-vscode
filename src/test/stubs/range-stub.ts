export class RangeStub {
  start: any;
  end: any;

  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    this.start = { line: startLine, character: startCharacter };
    this.end = { line: endLine, character: endCharacter };
  }

  intersection(range: RangeStub): RangeStub | undefined {
    const startLine = Math.max(this.start.line, range.start.line);
    const endLine = Math.min(this.end.line, range.end.line);

    if (startLine > endLine) {
      return undefined;
    }

    let startChar: number;
    let endChar: number;

    if (startLine === this.start.line && startLine === range.start.line) {
      startChar = Math.max(this.start.character, range.start.character);
    } else if (startLine === this.start.line) {
      startChar = this.start.character;
    } else {
      startChar = range.start.character;
    }

    if (endLine === this.end.line && endLine === range.end.line) {
      endChar = Math.min(this.end.character, range.end.character);
    } else if (endLine === this.end.line) {
      endChar = this.end.character;
    } else {
      endChar = range.end.character;
    }

    if (startLine === endLine && startChar >= endChar) {
      return undefined;
    }

    return new RangeStub(startLine, startChar, endLine, endChar);
  }

  contains(positionOrRange: any): boolean {
    if (this.isPosition(positionOrRange)) {
      return this.containsPosition(positionOrRange);
    } else {
      return this.containsRange(positionOrRange);
    }
  }

  private isPosition(positionOrRange: any): boolean {
    return positionOrRange.line !== undefined && positionOrRange.character !== undefined;
  }

  private containsPosition(pos: any): boolean {
    return pos.line >= this.start.line &&
           pos.line <= this.end.line &&
           (pos.line !== this.start.line || pos.character >= this.start.character) &&
           (pos.line !== this.end.line || pos.character <= this.end.character);
  }

  private containsRange(range: any): boolean {
    return this.contains(range.start) && this.contains(range.end);
  }
}
