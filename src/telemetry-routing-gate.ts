export interface RoutingGateOptions<T> {
  boundMs?: number;
  maxHeld?: number;
  isFirst?: (item: T) => boolean;
  send: (item: T) => void;
}

export class RoutingGate<T> {
  private currentGeneration = 0;
  private held = false;
  private boundTimer: NodeJS.Timeout | undefined;
  private queue: T[] = [];
  private closed = false;

  private readonly boundMs: number;
  private readonly maxHeld: number;
  private readonly isFirst?: (item: T) => boolean;
  private readonly send: (item: T) => void;

  constructor(options: RoutingGateOptions<T>) {
    this.boundMs = options.boundMs ?? 15000;
    this.maxHeld = options.maxHeld ?? 100;
    this.isFirst = options.isFirst;
    this.send = options.send;
  }

  hold(): number {
    if (this.closed) {
      return this.currentGeneration;
    }

    this.currentGeneration++;

    if (!this.held) {
      this.held = true;
      this.startBoundTimer();
    }

    return this.currentGeneration;
  }

  ready(generation: number): void {
    if (generation === this.currentGeneration && this.held) {
      this.release();
    }
  }

  submit(item: T): void {
    if (!this.held) {
      this.send(item);
      return;
    }

    this.queue.push(item);

    if (this.queue.length > this.maxHeld) {
      this.queue.shift();
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.release();
  }

  private startBoundTimer(): void {
    this.clearBoundTimer();
    this.boundTimer = setTimeout(() => {
      this.release();
    }, this.boundMs);
  }

  private clearBoundTimer(): void {
    if (this.boundTimer) {
      clearTimeout(this.boundTimer);
      this.boundTimer = undefined;
    }
  }

  private release(): void {
    this.held = false;
    this.clearBoundTimer();

    const toSend = [...this.queue];
    this.queue = [];

    if (this.isFirst && toSend.length > 0) {
      const firstIndex = toSend.findIndex(this.isFirst);
      if (firstIndex > 0) {
        const firstItem = toSend.splice(firstIndex, 1)[0];
        toSend.unshift(firstItem);
      }
    }

    for (const item of toSend) {
      this.send(item);
    }
  }
}
