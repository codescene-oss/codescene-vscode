import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { applyNoAceVariant } = require('../../../scripts/apply-build-variant');

const repoRoot = path.resolve(__dirname, '../../..');
const projectPackageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const projectReadme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
const sideBySideNotice =
  '> Do not install this extension alongside CodeScene (`codescene.codescene-vscode`). Uninstall one before installing the other.';

suite('Apply build variant Test Suite', () => {
  let projectRoot: string;

  setup(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-build-variant-'));
    fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify(projectPackageJson));
    fs.writeFileSync(path.join(projectRoot, 'README.md'), projectReadme);
  });

  teardown(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  test('the no-ACE variant keeps its own package name and display name', () => {
    const pkg = applyNoAceVariant(projectRoot);
    assert.deepStrictEqual(
      { name: pkg.name, displayName: pkg.displayName, version: pkg.version },
      { name: 'codescene-vscode-noace', displayName: 'CodeScene w/o ACE', version: projectPackageJson.version }
    );
  });

  test('the no-ACE variant contributes the same settings, commands and menus', () => {
    const pkg = applyNoAceVariant(projectRoot);
    assert.deepStrictEqual(pkg.contributes, projectPackageJson.contributes);
  });

  test('the no-ACE variant keeps the keywords and activation', () => {
    const pkg = applyNoAceVariant(projectRoot);
    assert.deepStrictEqual(
      { keywords: pkg.keywords, main: pkg.main, activationEvents: pkg.activationEvents },
      { keywords: projectPackageJson.keywords, main: projectPackageJson.main, activationEvents: projectPackageJson.activationEvents }
    );
  });

  test('the no-ACE variant README is the shared README with a side-by-side notice', () => {
    applyNoAceVariant(projectRoot);
    const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
    const eol = projectReadme.includes('\r\n') ? '\r\n' : '\n';
    assert.deepStrictEqual(
      { notice: readme.includes(sideBySideNotice), rest: readme.replace(`${eol}${sideBySideNotice}${eol}`, '') },
      { notice: true, rest: projectReadme }
    );
  });
});
