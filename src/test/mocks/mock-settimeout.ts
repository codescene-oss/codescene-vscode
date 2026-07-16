export class MockSetTimeout {
  calls: Array<{ callback: () => void; ms: number }> = [];
  private pendingWaits: Array<() => void> = [];

  setTimeout(callback: () => void, ms: number): any {
    this.calls.push({ callback, ms });
    const waiter = this.pendingWaits.shift();
    if (waiter) {
      waiter();
    }
    return this.calls.length - 1;
  }

  waitForNextCall(): Promise<void> {
    return new Promise(resolve => {
      this.pendingWaits.push(resolve);
    });
  }

  runNext(): void {
    const call = this.calls.shift();
    if (call) {
      call.callback();
    }
  }

  get callCount(): number {
    return this.calls.length;
  }
}
