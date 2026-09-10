import type { ChildProcess } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CHILD_PROCESS: Record<string, unknown> = require('child_process');

const HOOKED_FUNCTIONS = ['spawn', 'execFile', 'exec'] as const;

type SpawningFunction = (...args: unknown[]) => ChildProcess;

function redefine(name: string, value: unknown): void {
  Object.defineProperty(CHILD_PROCESS, name, { value, configurable: true, writable: true, enumerable: true });
}

export interface TrackedProcess {
  pid: number;
  command: string;
  spawnedAt: number;
  exitedAt?: number;
}

export class ProcessTracker {
  private readonly processes = new Map<number, TrackedProcess>();
  private readonly restore: Array<() => void> = [];
  private windowStart = 0;

  constructor(private readonly ignoreCommand: (command: string) => boolean = () => false) {}

  install(): void {
    if (this.restore.length > 0) return;
    for (const name of HOOKED_FUNCTIONS) {
      this.hook(name);
    }
  }

  uninstall(): void {
    this.restore.forEach((restore) => restore());
    this.restore.length = 0;
  }

  /**
   * Drops processes that already exited but keeps the ones still running, since a long lived
   * server started before the window still consumes resources inside it.
   */
  startWindow(): void {
    this.windowStart = Date.now();
    for (const [pid, tracked] of this.processes) {
      if (tracked.exitedAt !== undefined) this.processes.delete(pid);
    }
  }

  isPreexisting(pid: number): boolean {
    const tracked = this.processes.get(pid);
    return tracked === undefined || tracked.spawnedAt < this.windowStart;
  }

  livePids(): number[] {
    return Array.from(this.processes.values())
      .filter((tracked) => tracked.exitedAt === undefined)
      .map((tracked) => tracked.pid);
  }

  records(): TrackedProcess[] {
    return Array.from(this.processes.values());
  }

  windowWallMs(now: number): number {
    return this.records().reduce((sum, record) => {
      const from = Math.max(record.spawnedAt, this.windowStart);
      const until = Math.min(record.exitedAt ?? now, now);
      return sum + Math.max(0, until - from);
    }, 0);
  }

  private hook(name: string): void {
    const original = CHILD_PROCESS[name] as SpawningFunction;
    const tracker = this;
    const patched = function (this: unknown, ...args: unknown[]): ChildProcess {
      const child = original.apply(this, args);
      tracker.observe(child, String(args[0] ?? ''));
      return child;
    };
    Object.defineProperties(patched, Object.getOwnPropertyDescriptors(original));
    redefine(name, patched);
    this.restore.push(() => redefine(name, original));
  }

  private observe(child: ChildProcess, command: string): void {
    const pid = child?.pid;
    if (pid === undefined || this.ignoreCommand(command)) return;
    this.processes.set(pid, { pid, command, spawnedAt: Date.now() });
    child.once('exit', () => {
      const tracked = this.processes.get(pid);
      if (tracked) tracked.exitedAt = Date.now();
    });
  }
}
