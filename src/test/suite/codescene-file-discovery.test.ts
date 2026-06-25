import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { discoverCodeHealthRulesFileUris } from '../../git/codescene-file-discovery';

suite('codescene-file-discovery Test Suite', () => {
  let testRepoPath: string;

  setup(() => {
    testRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codescene-discovery-'));
    execSync('git init', { cwd: testRepoPath, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: testRepoPath, stdio: 'pipe' });
    execSync('git config advice.defaultBranchName false', { cwd: testRepoPath, stdio: 'pipe' });
  });

  teardown(() => {
    if (fs.existsSync(testRepoPath)) {
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    }
  });

  test('discovers workspace-root rules file via fs.existsSync', async () => {
    const rulesDir = path.join(testRepoPath, '.codescene');
    fs.mkdirSync(rulesDir, { recursive: true });
    const rulesPath = path.join(rulesDir, 'code-health-rules.json');
    fs.writeFileSync(rulesPath, '{}');

    const uris = await discoverCodeHealthRulesFileUris(testRepoPath, testRepoPath);
    assert.strictEqual(uris.length, 1);
    assert.strictEqual(uris[0].fsPath, path.normalize(rulesPath));
  });

  test('discovers tracked nested rules file via git ls-files', async function () {
    this.timeout(20000);

    const nestedRulesDir = path.join(testRepoPath, 'packages', 'app', '.codescene');
    fs.mkdirSync(nestedRulesDir, { recursive: true });
    const nestedRulesPath = path.join(nestedRulesDir, 'code-health-rules.json');
    fs.writeFileSync(nestedRulesPath, '{"rules":[]}');

    execSync('git add packages/app/.codescene/code-health-rules.json', { cwd: testRepoPath, stdio: 'pipe' });
    execSync('git commit -m "Add nested rules"', { cwd: testRepoPath, stdio: 'pipe' });

    const uris = await discoverCodeHealthRulesFileUris(testRepoPath, testRepoPath);
    const discoveredPaths = uris.map((uri) => uri.fsPath).sort();
    assert.ok(discoveredPaths.includes(path.normalize(nestedRulesPath)));
  });

  test('returns empty list when no rules files exist', async () => {
    const uris = await discoverCodeHealthRulesFileUris(testRepoPath, testRepoPath);
    assert.strictEqual(uris.length, 0);
  });
});
