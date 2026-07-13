import * as assert from 'assert';
import * as os from 'os';
import { isCpuTooBusy, setCpuProvider, resetCpuProvider } from '../../cpu-monitor';

suite('CPU Monitor Test Suite', () => {
  teardown(() => {
    resetCpuProvider();
  });

  const createCpuInfo = (idle: number, total: number) => {
    const nonIdle = total - idle;
    return {
      model: 'Test CPU',
      speed: 2400,
      times: {
        user: nonIdle * 0.6,
        nice: 0,
        sys: nonIdle * 0.4,
        idle: idle,
        irq: 0,
      },
    };
  };

  suite('with 8+ cores (75% threshold)', () => {
    [
      { usagePercent: 20, expected: false, desc: '20% usage (below threshold)' },
      { usagePercent: 70, expected: false, desc: '70% usage (below threshold)' },
      { usagePercent: 75, expected: false, desc: '75% usage (at threshold)' },
      { usagePercent: 80, expected: true, desc: '80% usage (above threshold)' },
      { usagePercent: 90, expected: true, desc: '90% usage (above threshold)' },
    ].forEach(({ usagePercent, expected, desc }) => {
      test(desc, async () => {
        const coreCount = 8;
        const deltaTotal = 1000;
        const deltaIdle = deltaTotal * (100 - usagePercent) / 100;

        const snapshots: os.CpuInfo[][] = [];
        let baseIdle = 5000;
        let baseTotal = 10000;

        for (let i = 0; i < 6; i++) {
          snapshots.push(Array(coreCount).fill(null).map(() => createCpuInfo(baseIdle, baseTotal)));
          baseIdle += deltaIdle;
          baseTotal += deltaTotal;
        }

        let providerCallCount = 0;
        const mockProvider = () => {
          const result = snapshots[providerCallCount % snapshots.length];
          providerCallCount++;
          return result;
        };
        setCpuProvider(mockProvider);

        const result = await isCpuTooBusy();
        assert.strictEqual(result, expected);
      });
    });
  });

  suite('with 4-7 cores (70% threshold)', () => {
    [
      { usagePercent: 20, expected: false, desc: '20% usage (below threshold)' },
      { usagePercent: 70, expected: false, desc: '70% usage (at threshold)' },
      { usagePercent: 75, expected: true, desc: '75% usage (above threshold)' },
      { usagePercent: 80, expected: true, desc: '80% usage (above threshold)' },
    ].forEach(({ usagePercent, expected, desc }) => {
      test(desc, async () => {
        const coreCount = 4;
        const deltaTotal = 1000;
        const deltaIdle = deltaTotal * (100 - usagePercent) / 100;

        const snapshots: os.CpuInfo[][] = [];
        let baseIdle = 5000;
        let baseTotal = 10000;

        for (let i = 0; i < 6; i++) {
          snapshots.push(Array(coreCount).fill(null).map(() => createCpuInfo(baseIdle, baseTotal)));
          baseIdle += deltaIdle;
          baseTotal += deltaTotal;
        }

        let providerCallCount = 0;
        const mockProvider = () => {
          const result = snapshots[providerCallCount % snapshots.length];
          providerCallCount++;
          return result;
        };
        setCpuProvider(mockProvider);

        const result = await isCpuTooBusy();
        assert.strictEqual(result, expected);
      });
    });
  });

  suite('with <4 cores (65% threshold)', () => {
    [
      { usagePercent: 20, expected: false, desc: '20% usage (below threshold)' },
      { usagePercent: 60, expected: false, desc: '60% usage (below threshold)' },
      { usagePercent: 65, expected: false, desc: '65% usage (at threshold)' },
      { usagePercent: 70, expected: true, desc: '70% usage (above threshold)' },
      { usagePercent: 80, expected: true, desc: '80% usage (above threshold)' },
    ].forEach(({ usagePercent, expected, desc }) => {
      test(desc, async () => {
        const coreCount = 2;
        const deltaTotal = 1000;
        const deltaIdle = deltaTotal * (100 - usagePercent) / 100;

        const snapshots: os.CpuInfo[][] = [];
        let baseIdle = 5000;
        let baseTotal = 10000;

        for (let i = 0; i < 6; i++) {
          snapshots.push(Array(coreCount).fill(null).map(() => createCpuInfo(baseIdle, baseTotal)));
          baseIdle += deltaIdle;
          baseTotal += deltaTotal;
        }

        let providerCallCount = 0;
        const mockProvider = () => {
          const result = snapshots[providerCallCount % snapshots.length];
          providerCallCount++;
          return result;
        };
        setCpuProvider(mockProvider);

        const result = await isCpuTooBusy();
        assert.strictEqual(result, expected);
      });
    });
  });

  suite('with mixed CPU loads', () => {
    test('calculates average across cores with different loads (8 cores)', async () => {
      const snapshots: os.CpuInfo[][] = [];
      let baseIdles = [5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];
      let baseTotals = [10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000];

      for (let i = 0; i < 6; i++) {
        snapshots.push(baseIdles.map((idle, idx) => createCpuInfo(idle, baseTotals[idx])));
        baseIdles = baseIdles.map((idle, idx) => idle + (idx < 4 ? 900 : 100));
        baseTotals = baseTotals.map(total => total + 1000);
      }

      let providerCallCount = 0;
      const mockProvider = () => {
        const result = snapshots[providerCallCount % snapshots.length];
        providerCallCount++;
        return result;
      };
      setCpuProvider(mockProvider);

      const result = await isCpuTooBusy();
      assert.strictEqual(result, false);
    });
  });
});
