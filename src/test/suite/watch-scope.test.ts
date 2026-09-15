import * as assert from 'assert';
import * as path from 'path';
import { normalizeFsPath } from '../../utils/fs-paths';
import { WatchScope, watchScopeKey, watchScopePaths, watchScopes } from '../../git/watch-scope';

suite('watchScopes Test Suite', () => {
  const monorepo = path.normalize('/monorepo');
  const other = path.normalize('/other');

  const cases: Array<{
    name: string;
    repoRoots: string[];
    folders: string[];
    expected: Array<[string, WatchScope]>;
  }> = [
    {
      name: 'a workspace folder at the git root watches the whole repository',
      repoRoots: [monorepo],
      folders: [monorepo],
      expected: [[monorepo, { kind: 'whole-repo' }]],
    },
    {
      name: 'a workspace folder above the git root watches the whole repository',
      repoRoots: [path.join(monorepo, 'nested')],
      folders: [monorepo],
      expected: [[path.join(monorepo, 'nested'), { kind: 'whole-repo' }]],
    },
    {
      name: 'a workspace folder below the git root narrows the watch to that folder',
      repoRoots: [monorepo],
      folders: [path.join(monorepo, 'packages', 'app')],
      expected: [[monorepo, { kind: 'paths', relativePaths: ['packages/app'] }]],
    },
    {
      name: 'several folders in one repository are collected into a single scope',
      repoRoots: [monorepo],
      folders: [path.join(monorepo, 'packages', 'app'), path.join(monorepo, 'packages', 'lib')],
      expected: [[monorepo, { kind: 'paths', relativePaths: ['packages/app', 'packages/lib'] }]],
    },
    {
      name: 'a folder nested inside another folder is collapsed away',
      repoRoots: [monorepo],
      folders: [path.join(monorepo, 'src', 'main'), path.join(monorepo, 'src')],
      expected: [[monorepo, { kind: 'paths', relativePaths: ['src'] }]],
    },
    {
      name: 'a folder inside a nested repository belongs to the nested repository only',
      repoRoots: [monorepo, path.join(monorepo, 'packages', 'vendored')],
      folders: [path.join(monorepo, 'packages', 'vendored', 'src')],
      expected: [[path.join(monorepo, 'packages', 'vendored'), { kind: 'paths', relativePaths: ['src'] }]],
    },
    {
      name: 'folders spread over two repositories are scoped per repository',
      repoRoots: [monorepo, other],
      folders: [path.join(monorepo, 'packages', 'app'), other],
      expected: [
        [monorepo, { kind: 'paths', relativePaths: ['packages/app'] }],
        [other, { kind: 'whole-repo' }],
      ],
    },
    {
      name: 'a repository the workspace does not reach into has no scope',
      repoRoots: [monorepo, other],
      folders: [path.join(monorepo, 'packages', 'app')],
      expected: [[monorepo, { kind: 'paths', relativePaths: ['packages/app'] }]],
    },
    {
      name: 'a repository has no scope when the workspace is empty',
      repoRoots: [monorepo],
      folders: [],
      expected: [],
    },
  ];

  cases.forEach(({ name, repoRoots, folders, expected }) => {
    test(name, () => {
      const scopes = watchScopes(
        repoRoots,
        folders.map((fsPath) => ({ uri: { fsPath } }))
      );

      assert.deepStrictEqual(
        Array.from(scopes.entries()),
        expected.map(([repoRoot, scope]) => [normalizeFsPath(repoRoot), scope])
      );
    });
  });

  test('exposes the relative paths only for a narrowed scope', () => {
    assert.strictEqual(watchScopePaths({ kind: 'whole-repo' }), undefined);
    assert.deepStrictEqual(watchScopePaths({ kind: 'paths', relativePaths: ['src'] }), ['src']);
  });

  test('gives a narrowed scope a key that differs from the whole repository', () => {
    assert.notStrictEqual(
      watchScopeKey({ kind: 'paths', relativePaths: ['packages/app'] }),
      watchScopeKey({ kind: 'whole-repo' })
    );
    assert.strictEqual(
      watchScopeKey({ kind: 'paths', relativePaths: ['packages/app', 'packages/lib'] }),
      watchScopeKey({ kind: 'paths', relativePaths: ['packages/app', 'packages/lib'] })
    );
  });
});
