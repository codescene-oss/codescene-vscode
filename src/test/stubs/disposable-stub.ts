export class DisposableStub {
  constructor(private readonly callOnDispose?: () => unknown) {}
  dispose() {
    this.callOnDispose?.();
  }
  static from(...disposables: Array<{ dispose: () => unknown }>) {
    return new DisposableStub(() => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    });
  }
}
