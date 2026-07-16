export class EventEmitterStub<T = any> {
  private listeners: Array<{ fn: (e: T) => any; thisArg?: any }> = [];

  event = (listener: (e: T) => any, thisArg?: any, disposables?: any[]) => {
    const entry = { fn: listener, thisArg };
    this.listeners.push(entry);
    const disposable = {
      dispose: () => {
        const index = this.listeners.indexOf(entry);
        if (index > -1) {
          this.listeners.splice(index, 1);
        }
      }
    };
    if (disposables) {
      disposables.push(disposable);
    }
    return disposable;
  };

  fire(data: T) {
    this.listeners.forEach(({ fn, thisArg }) => {
      if (thisArg) {
        fn.call(thisArg, data);
      } else {
        fn(data);
      }
    });
  }

  dispose() {
    this.listeners = [];
  }
}
