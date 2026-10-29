import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requiredDevtoolsVersion } from '../../artifact-info';
import { CsIdeServerClient } from '../../devtools-api/ide-server-client';
import {
  createBundledIdeServer,
  verifyIdeServerVersion,
} from '../../download';

function extensionRoot(): string {
  return path.join(__dirname, '../../..');
}

function mockClient(overrides: Partial<CsIdeServerClient> & { start: CsIdeServerClient['start'] }): CsIdeServerClient {
  const disposed = { value: false };
  return {
    dispose: () => {
      disposed.value = true;
    },
    ...overrides,
  } as CsIdeServerClient;
}

suite('Download Test Suite', function () {
  test('createBundledIdeServer throws when the distribution is incomplete', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codescene-download-missing-'));
    try {
      assert.throws(() => createBundledIdeServer(emptyDir), /incomplete/);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('createBundledIdeServer returns a client for the bundled distribution', () => {
    const client = createBundledIdeServer(extensionRoot());
    try {
      assert.ok(client.binaryPath);
    } finally {
      client.dispose();
    }
  });

  const verifyCases = [
    {
      name: 'succeeds when the server sha matches',
      start: async () => ({ sha: requiredDevtoolsVersion, version: 'test' }),
      expectError: false,
    },
    {
      name: 'disposes and throws when the server sha does not match',
      start: async () => ({ sha: 'not-the-required-sha', version: 'test' }),
      expectError: true,
    },
    {
      name: 'disposes and rethrows when start fails',
      start: async () => {
        throw new Error('start failed');
      },
      expectError: true,
    },
  ];

  for (const testCase of verifyCases) {
    test(`verifyIdeServerVersion ${testCase.name}`, async () => {
      let disposed = false;
      const client = mockClient({
        start: testCase.start,
        dispose: () => {
          disposed = true;
        },
      });

      if (testCase.expectError) {
        await assert.rejects(() => verifyIdeServerVersion(client));
        assert.strictEqual(disposed, true);
      } else {
        await verifyIdeServerVersion(client);
        assert.strictEqual(disposed, false);
      }
    });
  }

  test('verifyIdeServerVersion accepts the bundled distribution', async function () {
    this.timeout(60000);
    const client = createBundledIdeServer(extensionRoot());
    try {
      await verifyIdeServerVersion(client);
      assert.ok(fs.existsSync(client.binaryPath));
    } finally {
      client.dispose();
    }
  });
});
