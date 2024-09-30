import { ExtensionContext } from 'vscode';
import Telemetry from './telemetry';
import { getFileExtension } from './utils';

export interface Stats {
  analysis: AnalysisStats[];
}

export interface AnalysisStats {
  language: string;
  runs: number;
  avgTime: number;
  maxTime: number;
}

/**
 * Setup a scheduled event for sending usage statistics
 */
export function setupStatsCollector(context: ExtensionContext) {
  const timer = setInterval(() => {
    StatsCollector.instance.sendCurrentStats();
  }, 30 * 60 * 1000); // Every 30 mins

  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export class StatsCollector {
  static readonly instance = new StatsCollector();
  readonly stats: Stats = {
    analysis: [],
  };

  // Log execution stats by language to the telemetry logger
  sendCurrentStats() {
    if (this.stats.analysis.length > 0) {
      for (const byLanguage of this.stats.analysis) {
        Telemetry.instance.logUsage('stats', { stats: { analysis: byLanguage } });
      }
    }
    this.clear();
  }

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
