export class PositionStub {
  constructor(public line: number, public character: number) {}
  translate(lineDelta?: number | { lineDelta?: number; characterDelta?: number }, characterDelta?: number): PositionStub {
    const ld = typeof lineDelta === 'number' ? lineDelta : (lineDelta?.lineDelta ?? 0);
    const cd = typeof lineDelta === 'number' ? (characterDelta ?? 0) : (lineDelta?.characterDelta ?? 0);
    return new PositionStub(this.line + ld, this.character + cd);
  }
}
