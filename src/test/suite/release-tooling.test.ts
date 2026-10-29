import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.join(__dirname, '../../..');
const releasesUrl = 'https://github.com/codescene-oss/codescene-vscode/releases';

function readRepoFile(name: string): string {
  return fs.readFileSync(path.join(repoRoot, name), 'utf8');
}

function readJson(name: string) {
  return JSON.parse(readRepoFile(name));
}

suite('Release Tooling Test Suite', function () {
  test('retired release files are absent', () => {
    const cases = ['CHANGELOG.md', '.versionrc.json'];

    for (const file of cases) {
      assert.strictEqual(fs.existsSync(path.join(repoRoot, file)), false, `${file} should not exist`);
    }
  });

  test('package manifest keeps only the test-release script', () => {
    const manifest = readJson('package.json');

    for (const script of ['release:patch', 'release:minor', 'release:major']) {
      assert.strictEqual(manifest.scripts[script], undefined, `${script} should be removed`);
    }
    assert.strictEqual(manifest.devDependencies['commit-and-tag-version'], undefined);
    assert.strictEqual(manifest.scripts['release:test'], 'node ./scripts/create-test-release.js');
    assert.deepStrictEqual(
      Object.keys(manifest.scripts).filter((name) => name.startsWith('release:')),
      ['release:test']
    );
  });

  test('package lock no longer references commit-and-tag-version', () => {
    const lock = readJson('package-lock.json');

    assert.strictEqual(lock.packages['node_modules/commit-and-tag-version'], undefined);
    assert.strictEqual(lock.packages[''].devDependencies['commit-and-tag-version'], undefined);
    assert.strictEqual(lock.packages[''].version, readJson('package.json').version);
  });

  test('.vscodeignore no longer lists .versionrc.json', () => {
    const entries = readRepoFile('.vscodeignore')
      .split(/\r?\n/)
      .map((line) => line.trim());

    assert.strictEqual(entries.includes('.versionrc.json'), false);
  });

  test('both READMEs link to the GitHub Releases page', () => {
    const cases = ['README.md', 'README-noace.md'];

    for (const file of cases) {
      const text = readRepoFile(file);
      assert.ok(text.includes(releasesUrl), `${file} should link to ${releasesUrl}`);
    }
  });

  test('release notes section sits immediately before the configuration section', () => {
    const cases = ['README.md', 'README-noace.md'];

    for (const file of cases) {
      const headings = readRepoFile(file)
        .split(/\r?\n/)
        .filter((line) => line.startsWith('## '));
      const releaseNotes = headings.indexOf('## Release notes ##');

      assert.notStrictEqual(releaseNotes, -1, `${file} should have a Release notes section`);
      assert.strictEqual(headings[releaseNotes + 1], '## Configuration ##', `${file} section order`);
    }
  });
});
