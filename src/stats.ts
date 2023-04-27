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

  recordAnalysis(language: string, time: number) {
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
