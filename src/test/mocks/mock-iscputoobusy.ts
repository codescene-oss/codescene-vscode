export class MockIsCpuTooBusy {
  private responses: boolean[] = [];
  private callIndex = 0;
  calls: number = 0;

  constructor(responses: boolean[]) {
    this.responses = responses;
  }

  async isCpuTooBusy(): Promise<boolean> {
    const result = this.responses[this.callIndex % this.responses.length];
    this.callIndex++;
    this.calls++;
    return result;
  }
}
