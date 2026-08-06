import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CsIdeServerClient } from '../../devtools-api/ide-server-client';

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

  test('normalizes native device ID', async () => {
    assert.match((await client.deviceId())['device-id'], /^[a-f0-9]{32}$/);
  });
});
