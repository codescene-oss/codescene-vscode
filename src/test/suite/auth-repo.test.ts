import * as assert from 'assert';
import { pickRepo } from '../../auth/auth-repo';

suite('pickRepo', () => {
  const roots = ['/work/a', '/work/a/packages/b', '/work/c'];
  const cases = [
    { name: 'no repositories', roots: [], file: '/work/a/x.ts', expected: null },
    { name: 'the repository of the active file', roots, file: '/work/c/src/y.ts', expected: { path: '/work/c', name: 'c' } },
    {
      name: 'the outermost repository for a file in a nested root',
      roots,
      file: '/work/a/packages/b/z.ts',
      expected: { path: '/work/a', name: 'a' },
    },
    {
      name: 'the outermost repository when a nested root is listed first',
      roots: ['/work/a/packages/b', '/work/a'],
      file: '/work/a/packages/b/z.ts',
      expected: { path: '/work/a', name: 'a' },
    },
    {
      name: 'the first outermost repository without an active file when a nested root is listed first',
      roots: ['/work/a/packages/b', '/work/a'],
      file: undefined,
      expected: { path: '/work/a', name: 'a' },
    },
    { name: 'the first repository without an active file', roots, file: undefined, expected: { path: '/work/a', name: 'a' } },
    { name: 'the first repository for a file outside all roots', roots, file: '/tmp/q.ts', expected: { path: '/work/a', name: 'a' } },
    {
      name: 'a sibling whose name only shares a prefix with another root',
      roots: ['/work/a', '/work/ab'],
      file: '/work/ab/x.ts',
      expected: { path: '/work/ab', name: 'ab' },
    },
  ];

  for (const { name, roots: repoRoots, file, expected } of cases) {
    test(`picks ${name}`, () => {
      assert.deepStrictEqual(pickRepo(repoRoots, file), expected);
    });
  }
});
