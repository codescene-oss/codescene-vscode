import * as assert from 'assert';

import { StatsCollector } from '../../stats';

suite('Stats Test Suite', () => {
  // Create a new instance of StatsCollector before each test.
  let statsCollector: StatsCollector;
  setup(() => {
    statsCollector = new StatsCollector();
  });

  test('empty to start', () => {
    assert.ok(statsCollector.stats.analysis.length === 0);
  });

  test('handles one analysis', () => {
    statsCollector.recordAnalysis('java', 100);
    assert.ok(statsCollector.stats.analysis.length === 1);
    assert.ok(statsCollector.stats.analysis[0].language === 'java');
    assert.ok(statsCollector.stats.analysis[0].runs === 1);
    assert.ok(statsCollector.stats.analysis[0].avgTime === 100);
    assert.ok(statsCollector.stats.analysis[0].maxTime === 100);
  });

  test('handles averages', () => {
    statsCollector.recordAnalysis('java', 100);
    statsCollector.recordAnalysis('java', 200);
    assert.ok(statsCollector.stats.analysis.length === 1);
    assert.ok(statsCollector.stats.analysis[0].language === 'java');
    assert.ok(statsCollector.stats.analysis[0].runs === 2);
    assert.ok(statsCollector.stats.analysis[0].avgTime === 150);
    assert.ok(statsCollector.stats.analysis[0].maxTime === 200);
  });

  test('handles multiple languages', () => {
    statsCollector.recordAnalysis('java', 100);
    statsCollector.recordAnalysis('java', 200);
    statsCollector.recordAnalysis('python', 300);
    assert.ok(statsCollector.stats.analysis.length === 2);
    assert.ok(statsCollector.stats.analysis[0].language === 'java');
    assert.ok(statsCollector.stats.analysis[0].runs === 2);
    assert.ok(statsCollector.stats.analysis[0].avgTime === 150);
    assert.ok(statsCollector.stats.analysis[0].maxTime === 200);
    assert.ok(statsCollector.stats.analysis[1].language === 'python');
    assert.ok(statsCollector.stats.analysis[1].runs === 1);
    assert.ok(statsCollector.stats.analysis[1].avgTime === 300);
    assert.ok(statsCollector.stats.analysis[1].maxTime === 300);
  });

  test('clear', () => {
    statsCollector.recordAnalysis('java', 100);
    statsCollector.recordAnalysis('java', 200);
    statsCollector.recordAnalysis('python', 300);
    statsCollector.clear();
    assert.ok(statsCollector.stats.analysis.length === 0);
  });

  test('negative time', () => {
    statsCollector.recordAnalysis('java', -100);
    assert.ok(statsCollector.stats.analysis.length === 0);
  });
});