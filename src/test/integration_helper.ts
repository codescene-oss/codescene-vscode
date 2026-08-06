import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ArtifactInfo } from '../artifact-info';
import { ensureCompatibleBinary } from '../download';

export function createTestDir(testName: string): string {
  return path.join(os.homedir(), '.codescene-test-data', testName);
}

export async function ensureBinary(): Promise<string> {
  const extensionPath = path.join(__dirname, '../..');
  const artifact = new ArtifactInfo(extensionPath);
  const binaryPath = artifact.absoluteBinaryPath;

  const distributionReady =
    fs.existsSync(binaryPath) && fs.existsSync(artifact.absoluteJavaPath) && fs.existsSync(artifact.absoluteJarPath);

  if (!distributionReady) {
    console.log(`CLI distribution not found at ${binaryPath}, attempting to download...`);
    try {
      await ensureCompatibleBinary(extensionPath);
      console.log(`CLI distribution downloaded successfully to ${binaryPath}`);
    } catch (error) {
      throw new Error(
        `CLI distribution not found and download failed. ` +
          `Expected distribution at: ${binaryPath}. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (!fs.existsSync(artifact.absoluteJavaPath) || !fs.existsSync(artifact.absoluteJarPath)) {
    throw new Error(
      `CLI distribution still incomplete after download attempt. ` +
        `Expected java/jar under: ${binaryPath}. ` +
        `Please ensure the distribution is available for platform: ${process.platform}-${process.arch}`
    );
  }

  return binaryPath;
}
