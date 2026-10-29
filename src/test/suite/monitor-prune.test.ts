import * as assert from 'assert';
import * as path from 'path';
import { keepWithUnscopedFiles } from '../../code-health-monitor/monitor-prune';

suite('Monitor prune scoping', () => {
  const repoA = path.normalize('/repos/a');
  const repoB = path.normalize('/repos/b');
  const fileIn = (repoRoot: string, name: string) => path.join(repoRoot, name);

  const testCases = [
    {
      name: 'keeps files a reported repository still lists',
      monitored: [fileIn(repoA, 'kept.ts')],
      repoRoots: [repoA],
      keepPaths: [fileIn(repoA, 'kept.ts')],
      expected: [fileIn(repoA, 'kept.ts')],
    },
    {
      name: 'drops files a reported repository no longer lists',
      monitored: [fileIn(repoA, 'gone.ts')],
      repoRoots: [repoA],
      keepPaths: [] as string[],
      expected: [] as string[],
    },
    {
      name: 'keeps files belonging to a repository without a reported inventory',
      monitored: [fileIn(repoA, 'gone.ts'), fileIn(repoB, 'unknown.ts')],
      repoRoots: [repoA],
      keepPaths: [] as string[],
      expected: [fileIn(repoB, 'unknown.ts')],
    },
    {
      name: 'keeps files outside every known repository',
      monitored: [path.normalize('/elsewhere/loose.ts')],
      repoRoots: [repoA],
      keepPaths: [] as string[],
      expected: [path.normalize('/elsewhere/loose.ts')],
    },
    {
      name: 'does not treat a sibling repository with a shared prefix as nested',
      monitored: [path.normalize('/repos/ab/file.ts')],
      repoRoots: [repoA],
      keepPaths: [] as string[],
      expected: [path.normalize('/repos/ab/file.ts')],
    },
  ];

  testCases.forEach(({ name, monitored, repoRoots, keepPaths, expected }) => {
    test(name, () => {
      const result = keepWithUnscopedFiles(monitored, repoRoots, new Set(keepPaths));
      assert.deepStrictEqual(new Set(result), new Set(expected));
    });
  });
});
