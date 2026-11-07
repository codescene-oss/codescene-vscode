import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ArtifactInfo } from '../artifact-info';
import { createBundledIdeServer, verifyIdeServerVersion } from '../download';

export function createTestDir(testName: string): string {
  return path.join(os.homedir(), '.codescene-test-data', testName);
}

export async function ensureBinary(): Promise<string> {
  const extensionPath = path.join(__dirname, '../..');
  const artifact = new ArtifactInfo(extensionPath);
  const binaryPath = artifact.absoluteBinaryPath;

  const distributionReady = fs.existsSync(binaryPath) && fs.existsSync(artifact.absoluteExecutablePath);

  if (!distributionReady) {
    console.log(`CLI distribution not found at ${binaryPath}, attempting to download...`);
    try {
      const client = createBundledIdeServer(extensionPath);
      try {
        await verifyIdeServerVersion(client);
      } finally {
        client.dispose();
      }
      console.log(`CLI distribution downloaded successfully to ${binaryPath}`);
    } catch (error) {
      throw new Error(
        `CLI distribution not found and download failed. ` +
          `Expected distribution at: ${binaryPath}. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (!fs.existsSync(artifact.absoluteExecutablePath)) {
    throw new Error(
      `CLI distribution still incomplete after download attempt. ` +
        `Expected native binary at: ${artifact.absoluteExecutablePath}. ` +
        `Please ensure the distribution is available for platform: ${process.platform}-${process.arch}`
    );
  }

  return binaryPath;
}

/**
 * A test skipped right after setup can leave a short-lived child process (such as the git
 * availability check) inside the directory, which Windows refuses to remove until it exits.
 */
export async function removeTestDir(dir: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt >= 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export const CREDENTIAL_SKIP_REASON =
  'needs a CodeScene credential: set CS_ACCESS_TOKEN (CLI access) to run real cs-ide analysis tests';

export function hasCodeSceneCredential(): boolean {
  return Boolean(process.env.CS_ACCESS_TOKEN?.trim());
}

/**
 * cs-ide answers its Code Health methods only with a valid CLI license, which these tests get from
 * the CS_ACCESS_TOKEN the spawned binary inherits. Without one the calling test is reported as
 * pending with the reason in its title.
 */
export function skipWithoutCodeSceneCredential(context: Mocha.Context): void {
  if (hasCodeSceneCredential()) return;
  const test = context.currentTest ?? context.test;
  if (test && !test.title.endsWith(`(${CREDENTIAL_SKIP_REASON})`)) {
    test.title = `${test.title} (${CREDENTIAL_SKIP_REASON})`;
  }
  context.skip();
}
