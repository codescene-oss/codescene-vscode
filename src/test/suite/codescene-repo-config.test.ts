import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  CODE_SCENE_DIR,
  CONFIG_FILE_NAME,
  getBaselineBranch,
  gitRootFromCodesceneConfigUri,
} from '../../git/codescene-repo-config';

suite('Codescene Repo Config Test Suite', () => {
  let gitRootPath: string;
  let configPath: string;

  setup(() => {
    gitRootPath = path.join(__dirname, `../../../test-codescene-config-${Date.now()}`);
    const codesceneDir = path.join(gitRootPath, CODE_SCENE_DIR);
    fs.mkdirSync(codesceneDir, { recursive: true });
    configPath = path.join(codesceneDir, CONFIG_FILE_NAME);
  });

  teardown(() => {
    if (fs.existsSync(gitRootPath)) {
      fs.rmSync(gitRootPath, { recursive: true, force: true });
    }
  });

  test('getBaselineBranch when file missing returns undefined', () => {
    assert.ok(!fs.existsSync(configPath));
    assert.strictEqual(getBaselineBranch(gitRootPath), undefined);
  });

  test('getBaselineBranch when valid returns branch name', () => {
    fs.writeFileSync(configPath, '{"baseline_branch":"develop"}');
    assert.strictEqual(getBaselineBranch(gitRootPath), 'develop');
  });

  test('getBaselineBranch when whitespace only returns undefined', () => {
    fs.writeFileSync(configPath, '{"baseline_branch":" "}');
    assert.strictEqual(getBaselineBranch(gitRootPath), undefined);
  });

  test('getBaselineBranch when invalid json returns undefined', () => {
    fs.writeFileSync(configPath, 'not json');
    assert.strictEqual(getBaselineBranch(gitRootPath), undefined);
  });

  test('getBaselineBranch when property missing returns undefined', () => {
    fs.writeFileSync(configPath, '{"other":"value"}');
    assert.strictEqual(getBaselineBranch(gitRootPath), undefined);
  });

  test('getBaselineBranch when git root undefined returns undefined', () => {
    assert.strictEqual(getBaselineBranch(undefined), undefined);
  });

  test('gitRootFromCodesceneConfigUri returns repo root for config path', () => {
    const configPath = path.join(gitRootPath, CODE_SCENE_DIR, CONFIG_FILE_NAME);
    assert.strictEqual(gitRootFromCodesceneConfigUri({ fsPath: configPath }), gitRootPath);
  });

  test('gitRootFromCodesceneConfigUri returns undefined for non-codescene path', () => {
    assert.strictEqual(
      gitRootFromCodesceneConfigUri({ fsPath: path.join(gitRootPath, 'src', 'file.ts') }),
      undefined
    );
  });
});
