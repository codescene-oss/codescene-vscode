import { logOutputChannel } from './log';
import { AvgTime } from './avg-time';
import { Command } from './executor';

export class Stats {
  private stats: Map<string, AvgTime> = new Map<string, AvgTime>();
  addRun(command: Command, duration: number) {
    const { args, command: binaryPath } = command;
    if (args.length < 1) return;

    const csCommand = args[0];
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
