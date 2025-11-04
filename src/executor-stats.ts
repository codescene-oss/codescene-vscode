import { logOutputChannel } from './log';
import { AvgTime } from './avg-time';
import { Command } from './executor';

export class Stats {
  private stats: Map<string, AvgTime> = new Map<string, AvgTime>();
  addRun(command: Command, duration: number) {
    const { args, command: binaryPath } = command;
    if (args.length < 1) return;

    let csCommand = args[0];
    if (args[0] === 'refactor') { // keep actual refactoring command as well (i.e. preflight/fns-to-refactor/post)
      csCommand = args.slice(0, 2).join(' ');
    }
    const shortCmd = binaryPath.substring(binaryPath.lastIndexOf('/') + 1, binaryPath.length);
    const cmdKey = `${shortCmd} ${csCommand}`;
    if (!this.stats.has(cmdKey)) {
      this.stats.set(cmdKey, new AvgTime());
    }
    this.stats.get(cmdKey)!.addRun(duration);
  }
  logStats() {
    logOutputChannel.info('Executor avg times:');
    for (const [cmdKey, avgTime] of this.stats) {
      logOutputChannel.info(`  ${cmdKey}: ${avgTime.averageDuration}ms (${avgTime.invocations} invocations)`);
    }
  }
}
