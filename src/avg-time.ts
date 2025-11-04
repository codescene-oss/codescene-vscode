export class AvgTime {
  invocations = 0;
  private totalDuration = 0;
  addRun(duration: number) {
    this.invocations++;
    this.totalDuration += duration;
  }
  get averageDuration() {
    return this.invocations > 0 ? this.totalDuration / this.invocations : 0;
  }
}
