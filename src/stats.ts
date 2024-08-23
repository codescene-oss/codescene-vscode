import { getFileExtension } from "./utils";

export interface Stats {
  analysis: AnalysisStats[];
}

export interface AnalysisStats {
  language: string;
  runs: number;
  avgTime: number;
  maxTime: number;
}

export class StatsCollector {
  static readonly instance = new StatsCollector();
  readonly stats: Stats = {
    analysis: [],
  };

  recordAnalysis(fileName: string, time: number) {
    // Skip record if time is negative or zero. Must be some kind of error.
    if (time <= 0) return;

    const language = getFileExtension(fileName);

    const analysis = this.stats.analysis.find((a) => a.language === language);
    if (analysis) {
      analysis.runs++;
      analysis.avgTime = (analysis.avgTime + time) / 2;
      analysis.maxTime = Math.max(analysis.maxTime, time);
    } else {
      this.stats.analysis.push({
        language,
        runs: 1,
        avgTime: time,
        maxTime: time,
      });
    }
  }

  clear() {
    this.stats.analysis = [];
  }
}
