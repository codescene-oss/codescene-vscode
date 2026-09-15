import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CsIdeServerClient, WatchInventory } from '../../devtools-api/ide-server-client';
import { pathsEqual } from '../../utils/fs-paths';

const localDistribution = process.env.CS_IDE_DISTRIBUTION_PATH;

suite('Native IDE Server Contract Test Suite', function () {
  if (!localDistribution) return;

  this.timeout(30_000);
  let client: CsIdeServerClient;

  setup(() => {
    client = CsIdeServerClient.fromDistribution(localDistribution, ['server', '--threads', '1']);
  });

  teardown(() => client.dispose());

  test('normalizes native review and delta notifications', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const relPath = 'src/device-id.ts';
    const content = `${fs.readFileSync(path.join(repoRoot, relPath), 'utf8')}
function nativeContractComplexity(value: number) {
  if (value > 0) value++;
  if (value > 1) value++;
  if (value > 2) value++;
  if (value > 3) value++;
  if (value > 4) value++;
  if (value > 5) value++;
  if (value > 6) value++;
  if (value > 7) value++;
  if (value > 8) value++;
  return value;
}
`;
    const review = new Promise<number | undefined>((resolve) => {
      client.onDidReview((event) => resolve(event.result.score));
    });
    const delta = new Promise<number | undefined>((resolve) => {
      client.onDidDelta((event) => resolve(event.result?.['new-score']));
    });

    client.reviewFiles(repoRoot, [{ id: 'native-contract', relPath, content }]);

    assert.strictEqual(typeof await review, 'number');
    assert.strictEqual(typeof await delta, 'number');
  });

  test('emits id-less fileReview for disk reviewFiles', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const review = new Promise<{ id?: string; path: string; score: number | undefined }>((resolve) => {
      client.onDidReview((event) => resolve({
        id: event.id,
        path: event.path.replace(/\\/g, '/'),
        score: event.result.score,
      }));
    });

    client.reviewFiles(repoRoot, [{ relPath: 'src/device-id.ts' }]);

    const event = await review;
    assert.strictEqual(event.id, undefined);
    assert.strictEqual(event.path, 'src/device-id.ts');
    assert.strictEqual(typeof event.score, 'number');
  });

  test('accepts watchFiles and stopWatchFiles without error', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    await client.start();
    const error = new Promise<Error | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), 1500);
      client.onDidError((err) => {
        clearTimeout(timer);
        resolve(err);
      });
    });
    client.watchFiles(repoRoot);
    client.stopWatchFiles(repoRoot);
    assert.strictEqual(await error, undefined);
  });

  test('pushes the watch inventory and serves the same set on request', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    await client.start();
    const pushed = new Promise<WatchInventory>((resolve) => {
      client.onDidWatchInventory((event) => resolve(event));
    });

    client.watchFiles(repoRoot);

    const notified = await pushed;
    const requested = await client.getWatchInventory(repoRoot);
    client.stopWatchFiles(repoRoot);

    assert.ok(pathsEqual(notified.repoRoot, repoRoot), `notified ${notified.repoRoot} is not ${repoRoot}`);
    assert.ok(pathsEqual(requested.repoRoot, repoRoot), `requested ${requested.repoRoot} is not ${repoRoot}`);
    assert.deepStrictEqual(new Set(requested.files), new Set(notified.files));
    assert.ok(notified.files.every((file) => !file.includes('\\')), 'inventory paths are repo-relative posix paths');
  });

  test('normalizes native device ID', async () => {
    assert.match((await client.deviceId())['device-id'], /^[a-f0-9]{32}$/);
  });
});
