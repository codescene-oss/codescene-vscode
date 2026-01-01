export class EventEmitterStub<T = any> {
  private listeners: Array<(e: T) => any> = [];

  event = (listener: (e: T) => any) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index > -1) {
          this.listeners.splice(index, 1);
        }
      }
    };
  };

  fire(data: T) {
    this.listeners.forEach(listener => listener(data));
  }

  dispose() {
    this.listeners = [];
  }
}
