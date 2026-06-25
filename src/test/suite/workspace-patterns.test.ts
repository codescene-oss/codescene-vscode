import * as assert from 'assert';
import * as path from 'path';
import {
  isCodeHealthRulesFile,
  isCodesceneConfigFile,
  isGitignoreFile,
  isSupportedSourceFile,
  normalizePathForMatch,
} from '../../utils/workspace-patterns';

suite('workspace-patterns Test Suite', () => {
  test('normalizePathForMatch uses forward slashes', () => {
    const normalized = normalizePathForMatch('C:\\repo\\src\\file.ts');
    assert.strictEqual(normalized, 'C:/repo/src/file.ts');
  });

  test('isSupportedSourceFile accepts supported extensions only', () => {
    assert.strictEqual(isSupportedSourceFile('/repo/src/file.ts'), true);
    assert.strictEqual(isSupportedSourceFile('/repo/docs/readme.md'), false);
    assert.strictEqual(isSupportedSourceFile('/repo/Makefile'), false);
  });

  test('isGitignoreFile matches basename only', () => {
    assert.strictEqual(isGitignoreFile('/repo/.gitignore'), true);
    assert.strictEqual(isGitignoreFile('/repo/nested/.gitignore'), true);
    assert.strictEqual(isGitignoreFile('/repo/.gitignore.bak'), false);
  });

  test('isCodeHealthRulesFile matches nested codescene rules path', () => {
    const rulesPath = path.join('repo', 'pkg', '.codescene', 'code-health-rules.json');
    assert.strictEqual(isCodeHealthRulesFile(rulesPath), true);
    assert.strictEqual(isCodeHealthRulesFile(path.join('repo', '.codescene', 'config.json')), false);
  });

  test('isCodesceneConfigFile matches nested codescene config path', () => {
    const configPath = path.join('repo', '.codescene', 'config.json');
    assert.strictEqual(isCodesceneConfigFile(configPath), true);
    assert.strictEqual(isCodesceneConfigFile(path.join('repo', '.codescene', 'code-health-rules.json')), false);
  });
});
