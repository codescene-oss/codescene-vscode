import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const scriptPath = '../../../scripts/migrate-changelog-to-releases';
const startMarker = '<!-- changelog-migration:start -->';
const endMarker = '<!-- changelog-migration:end -->';
const historyHint = 'CHANGELOG.md deletion not found in git history; pass --file <path>.';

function load() {
  return require(scriptPath);
}

function block(section: string) {
  return `${startMarker}\n## Changelog\n\n${section}\n${endMarker}\n`;
}

function release(tag: string, body: string | null, overrides: Record<string, unknown> = {}) {
  return { id: Number(tag.replace(/\D/g, '')), tag_name: tag, draft: false, prerelease: false, body, ...overrides };
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-changelog-migration-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitAs(repo: string, message: string) {
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', message);
}

function initRepo(dir: string) {
  git(dir, 'init', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'readme\n');
  commitAs(dir, 'Initial commit');
}

function fakeGitHub(releases: unknown[]) {
  const writes: Array<{ id: number; body: string }> = [];
  return {
    writes,
    listReleases: () => releases,
    updateReleaseBody: (id: number, body: string) => {
      writes.push({ id, body });
    },
  };
}

function runWith(argv: string[], overrides: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const deps = {
    cwd: '/work',
    readFile: () => {
      throw new Error('readFile not expected');
    },
    readChangelogFromHistory: () => '',
    github: fakeGitHub([]),
    log: (line: string) => logs.push(line),
    ...overrides,
  };
  const result = load().run(argv, deps);
  return { logs, result };
}

const changelogText = [
  '# Changelog',
  '',
  'All notable changes to this project will be documented in this file.',
  '',
  '### [0.2.0](https://example.com/compare/v0.1.0...v0.2.0) (2026-01-02)',
  '',
  '### Features',
  '',
  '* add a thing',
  '',
  '### 0.1.5 (2026-01-01)',
  '',
  '### 0.1.4 (2025-12-31)',
  '',
  '## [0.1.0](https://example.com/compare/v0.0.9...v0.1.0) (2025-12-30)',
  '',
  '### Bug fixes',
  '',
  '* fix a thing',
  '',
].join('\n');

suite('Changelog Migration Script Test Suite', function () {
  this.timeout(30000);

  test('parses version sections', () => {
    const { parseChangelog } = load();
    const cases: Array<{ name: string; text: string; expected: Array<{ version: string; body: string }> }> = [
      {
        name: 'linked ### heading',
        text: '### [1.2.3](https://x/compare) (2026-01-01)\n\n* one\n',
        expected: [{ version: '1.2.3', body: '* one' }],
      },
      {
        name: 'linked ## heading',
        text: '## [1.2.0](https://x/compare) (2026-01-01)\n\n* two\n',
        expected: [{ version: '1.2.0', body: '* two' }],
      },
      {
        name: 'unlinked heading',
        text: '### 0.0.21 (2025-01-01)\n\n* three\n',
        expected: [{ version: '0.0.21', body: '* three' }],
      },
      {
        name: 'heading without date',
        text: '## 3.0.0\n* four\n',
        expected: [{ version: '3.0.0', body: '* four' }],
      },
      {
        name: 'non-version subheadings stay inside',
        text: '### [1.0.0](u) (d)\n\n### Features\n\n* a\n\n### Bug fixes\n\n* b\n\n### ⚠ BREAKING CHANGES\n\n* c\n',
        expected: [{ version: '1.0.0', body: '### Features\n\n* a\n\n### Bug fixes\n\n* b\n\n### ⚠ BREAKING CHANGES\n\n* c' }],
      },
      {
        name: 'empty section',
        text: '### [1.0.1](u) (d)\n\n### [1.0.0](u) (d)\n\n* x\n',
        expected: [
          { version: '1.0.1', body: '' },
          { version: '1.0.0', body: '* x' },
        ],
      },
      {
        name: 'header blurb ignored',
        text: '# Changelog\n\nSome blurb\n### Notes\n\n### [1.0.0](u) (d)\n\n* x\n',
        expected: [{ version: '1.0.0', body: '* x' }],
      },
      {
        name: 'prerelease-style and deeper headings are not versions',
        text: '### [1.0.0](u) (d)\n\n### 1.0.1-beta.1 (d)\n\n#### 1.0.2 (d)\n\n### 1.0.34x\n',
        expected: [
          { version: '1.0.0', body: '### 1.0.1-beta.1 (d)\n\n#### 1.0.2 (d)\n\n### 1.0.34x' },
        ],
      },
      {
        name: 'CRLF line endings',
        text: '### [1.0.1](u) (d)\r\n\r\n* a\r\n\r\n### [1.0.0](u) (d)\r\n\r\n* b\r\n',
        expected: [
          { version: '1.0.1', body: '* a' },
          { version: '1.0.0', body: '* b' },
        ],
      },
    ];
    for (const { name, text, expected } of cases) {
      assert.deepStrictEqual(parseChangelog(text), expected, name);
    }
  });

  test('parses a full changelog in file order', () => {
    const { parseChangelog } = load();
    assert.deepStrictEqual(parseChangelog(changelogText), [
      { version: '0.2.0', body: '### Features\n\n* add a thing' },
      { version: '0.1.5', body: '' },
      { version: '0.1.4', body: '' },
      { version: '0.1.0', body: '### Bug fixes\n\n* fix a thing' },
    ]);
  });

  test('rejects a repeated version naming it', () => {
    const { parseChangelog } = load();
    assert.throws(
      () => parseChangelog('### [1.0.0](u) (d)\n\n* a\n\n## 1.0.0 (d)\n\n* b\n'),
      /Duplicate changelog section for version 1\.0\.0/
    );
  });

  test('appends and replaces the marked block', () => {
    const { applyChangelogBlock } = load();
    const cases: Array<{ name: string; body: string; section: string; expected: string }> = [
      {
        name: 'body without block',
        body: '## What is Changed\n\n* a',
        section: '### Features\n\n* x',
        expected: `## What is Changed\n\n* a\n\n${block('### Features\n\n* x')}`,
      },
      {
        name: 'empty body',
        body: '',
        section: '* x',
        expected: block('* x'),
      },
      {
        name: 'body with old block is replaced, not duplicated',
        body: `## What is Changed\n\n* a\n\n${block('* old')}`,
        section: '* new',
        expected: `## What is Changed\n\n* a\n\n${block('* new')}`,
      },
      {
        name: 'body with trailing newline',
        body: '* a\n',
        section: '* x',
        expected: `* a\n\n${block('* x')}`,
      },
      {
        name: 'text after the old block is kept outside it',
        body: `* a\n\n${block('* old')}\n* tail`,
        section: '* new',
        expected: `* a\n\n* tail\n\n${block('* new')}`,
      },
    ];
    for (const { name, body, section, expected } of cases) {
      const once = applyChangelogBlock(body, section);
      assert.strictEqual(once, expected, name);
      assert.strictEqual(applyChangelogBlock(once, section), once, `${name} is idempotent`);
      assert.strictEqual(once.split(startMarker).length, 2, `${name} has one block`);
    }
  });

  test('plans the migration', () => {
    const { planMigration } = load();
    const sections = [
      { version: '1.0.0', body: '* matched' },
      { version: '0.9.0', body: '* current' },
      { version: '0.8.0', body: '* no release' },
      { version: '0.7.0', body: '' },
      { version: '0.6.0', body: '* test only' },
      { version: '0.5.0', body: '* draft only' },
      { version: '0.4.0', body: '' },
    ];
    const releases = [
      release('v1.0.0', '## Notes', { id: 100 }),
      release('v0.9.0', `## Notes\n\n${block('* current')}`, { id: 90 }),
      release('v0.7.0', '## Notes', { id: 70 }),
      release('v0.6.0-test.abc1234', '', { id: 61, prerelease: true }),
      release('v0.6.0', '', { id: 60, prerelease: true }),
      release('v0.5.0', '', { id: 50, draft: true }),
    ];
    assert.deepStrictEqual(planMigration(sections, releases), {
      updates: [
        { id: 100, tag: 'v1.0.0', body: '## Notes', newBody: `## Notes\n\n${block('* matched')}` },
      ],
      upToDate: ['v0.9.0'],
      unmatched: ['0.8.0', '0.6.0', '0.5.0', '0.4.0'],
      empty: ['0.7.0'],
    });
  });

  test('plans against a release with a null body', () => {
    const { planMigration } = load();
    const plan = planMigration([{ version: '1.0.0', body: '* x' }], [release('v1.0.0', null, { id: 7 })]);
    assert.deepStrictEqual(plan.updates, [{ id: 7, tag: 'v1.0.0', body: '', newBody: block('* x') }]);
  });

  test('planning never targets non-stable tags', () => {
    const { planMigration } = load();
    const plan = planMigration(
      [{ version: '1.0.0', body: '* x' }],
      [release('v1.0.0-test.abcdef0', 'x'), release('release-1.0.0', 'x'), release('1.0.0', 'x')]
    );
    assert.deepStrictEqual(plan, { updates: [], upToDate: [], unmatched: ['1.0.0'], empty: [] });
  });

  test('dry run writes nothing', () => {
    const github = fakeGitHub([release('v0.2.0', '## Notes'), release('v0.1.4', '## Notes')]);
    const { logs, result } = runWith([], { github, readChangelogFromHistory: () => changelogText });
    assert.deepStrictEqual(github.writes, []);
    assert.deepStrictEqual(
      result.updates.map((update: { tag: string }) => update.tag),
      ['v0.2.0']
    );
    const output = logs.join('\n');
    assert.ok(output.includes('v0.2.0'));
    assert.ok(output.includes(block('### Features\n\n* add a thing')));
    assert.ok(output.includes('Up to date: none'));
    assert.ok(output.includes('Changelog sections without a stable release: 0.1.5, 0.1.0'));
    assert.ok(output.includes('Empty changelog sections: 0.1.4'));
    assert.ok(output.includes('Pass --apply'));
  });

  test('apply updates only changed releases', () => {
    const current = `## Notes\n\n${block('### Features\n\n* add a thing')}`;
    const github = fakeGitHub([
      release('v0.2.0', current, { id: 2 }),
      release('v0.1.0', '## Notes', { id: 1 }),
      release('v0.1.4', '## Notes', { id: 4 }),
    ]);
    const { logs } = runWith(['--apply'], { github, readChangelogFromHistory: () => changelogText });
    assert.deepStrictEqual(github.writes, [{ id: 1, body: `## Notes\n\n${block('### Bug fixes\n\n* fix a thing')}` }]);
    const output = logs.join('\n');
    assert.ok(output.includes('Updated v0.1.0'));
    assert.ok(output.includes('Up to date: v0.2.0'));
    assert.ok(output.includes('Empty changelog sections: 0.1.4'));
    assert.ok(!output.includes('Pass --apply'));
  });

  test('apply twice converges to no further writes', () => {
    const releases = [release('v0.2.0', '## Notes', { id: 2 })];
    const github = {
      writes: [] as Array<{ id: number; body: string }>,
      listReleases: () => releases,
      updateReleaseBody: (id: number, body: string) => {
        github.writes.push({ id, body });
        releases[0].body = body;
      },
    };
    const deps = { github, readChangelogFromHistory: () => changelogText };
    runWith(['--apply'], deps);
    runWith(['--apply'], deps);
    assert.strictEqual(github.writes.length, 1);
  });

  test('reads CHANGELOG.md from before its deletion', () => {
    withTempDir((dir) => {
      initRepo(dir);
      fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '### [1.0.0](u) (d)\n\n* first\n');
      commitAs(dir, 'Add changelog');
      fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '### [1.0.0](u) (d)\n\n* first\n\n### [1.1.0](u) (d)\n\n* second\n');
      commitAs(dir, 'Update changelog');
      fs.rmSync(path.join(dir, 'CHANGELOG.md'));
      commitAs(dir, 'Remove changelog');
      fs.writeFileSync(path.join(dir, 'OTHER.md'), 'other\n');
      commitAs(dir, 'Later commit');
      const text = load().readChangelogFromHistory(dir);
      assert.strictEqual(text, '### [1.0.0](u) (d)\n\n* first\n\n### [1.1.0](u) (d)\n\n* second\n');
    });
  });

  test('throws the --file hint when the changelog was never deleted', () => {
    withTempDir((dir) => {
      initRepo(dir);
      fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '* kept\n');
      commitAs(dir, 'Add changelog');
      assert.throws(() => load().readChangelogFromHistory(dir), new Error(historyHint));
    });
  });

  test('history lookup uses git log then git show on the parent commit', () => {
    const calls: string[][] = [];
    const exec = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return args[0] === 'log' ? 'abc123\n' : 'content';
    };
    assert.strictEqual(load().readChangelogFromHistory('/repo', exec), 'content');
    assert.deepStrictEqual(calls, [
      ['git', 'log', '-1', '--diff-filter=D', '--format=%H', '--', 'CHANGELOG.md'],
      ['git', 'show', 'abc123^:CHANGELOG.md'],
    ]);
  });

  test('--file overrides the history source', () => {
    const reads: string[] = [];
    const github = fakeGitHub([release('v0.1.0', '## Notes', { id: 1 })]);
    const { result } = runWith(['--file', 'old/CHANGELOG.md'], {
      github,
      readFile: (file: string) => {
        reads.push(file);
        return '### [0.1.0](u) (d)\n\n* from file\n';
      },
      readChangelogFromHistory: () => {
        throw new Error('history must not be read');
      },
    });
    assert.deepStrictEqual(reads, [path.resolve('/work', 'old/CHANGELOG.md')]);
    assert.strictEqual(result.updates.length, 1);
    assert.ok(result.updates[0].newBody.includes('* from file'));
  });

  test('rejects unknown flags', () => {
    const cases = [['--bogus'], ['--apply', '--force'], ['positional']];
    for (const argv of cases) {
      assert.throws(() => runWith(argv), /Unknown option .*Usage: migrate-changelog-to-releases\.js/, argv.join(' '));
    }
  });

  test('rejects flags missing their value', () => {
    for (const argv of [['--file'], ['--repo'], ['--file', '--apply']]) {
      assert.throws(() => runWith(argv), /Missing value for --(file|repo)/, argv.join(' '));
    }
  });

  test('lists releases through gh with all pages flattened', () => {
    const calls: string[][] = [];
    const exec = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return JSON.stringify([
        [{ id: 1, tag_name: 'v1.0.0', draft: false, prerelease: false, body: 'a', assets: [{ id: 9 }], name: 'x' }],
        [{ id: 2, tag_name: 'v0.9.0', draft: true, prerelease: false, body: null }],
      ]);
    };
    const releases = load().createGitHub('owner/name', exec).listReleases();
    assert.deepStrictEqual(calls, [['gh', 'api', '--paginate', '--slurp', 'repos/owner/name/releases?per_page=100']]);
    assert.deepStrictEqual(releases, [
      { id: 1, tag_name: 'v1.0.0', draft: false, prerelease: false, body: 'a' },
      { id: 2, tag_name: 'v0.9.0', draft: true, prerelease: false, body: null },
    ]);
  });

  test('updates a release body through a temp file', () => {
    const calls: string[][] = [];
    let content = '';
    let file = '';
    const exec = (command: string, args: string[]) => {
      calls.push([command, ...args.slice(0, -1)]);
      file = args[args.length - 1].replace(/^body=@/, '');
      content = fs.readFileSync(file, 'utf8');
      return '';
    };
    load().createGitHub('owner/name', exec).updateReleaseBody(42, 'new body\n');
    assert.deepStrictEqual(calls, [['gh', 'api', '-X', 'PATCH', 'repos/owner/name/releases/42', '-F']]);
    assert.strictEqual(content, 'new body\n');
    assert.ok(!fs.existsSync(file));
  });
});
