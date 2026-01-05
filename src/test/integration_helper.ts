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
  const binaryPath = new ArtifactInfo(extensionPath).absoluteBinaryPath;

  if (!fs.existsSync(binaryPath)) {
    console.log(`CLI binary not found at ${binaryPath}, attempting to download...`);
    try {
      await ensureCompatibleBinary(extensionPath);
      console.log(`CLI binary downloaded successfully to ${binaryPath}`);
    } catch (error) {
      throw new Error(
        `CLI binary not found and download failed. ` +
          `Expected binary at: ${binaryPath}. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `CLI binary still not found after download attempt. ` +
        `Expected at: ${binaryPath}. ` +
        `Please ensure the binary is available for platform: ${process.platform}-${process.arch}`
    );
  }

  return binaryPath;
}
