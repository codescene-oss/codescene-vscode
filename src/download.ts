// The strategy for using the CodeScene devtools binary is as follows:
//
// 1. The binary for the current platform is bundled with the extension during the build process.
// 2. When the extension is activated, we check if the bundled binary exists and verify its version
//    matches the required devtools version.
// 3. If the binary is missing or invalid, the extension will fail to activate with a clear error.

import * as fs from 'fs';
import * as path from 'path';
import { SimpleExecutor } from './simple-executor';
import { logOutputChannel } from './log';
import { requiredDevtoolsVersion } from './artifact-info';

// Re-export for backward compatibility
export { requiredDevtoolsVersion };

/**
 * Get the bundled binary path for the current platform and architecture.
 */
function getBundledBinaryPath(extensionPath: string): string {
  // E.g. cs-darwin-x64/arm64, cs-linux-x64, cs-win32-x64.exe
  const binaryName = `cs-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
  return path.join(extensionPath, binaryName);
}

/**
 * Verify that the binary matches the expected required version.
 */
async function verifyBinaryVersion(binaryPath: string): Promise<boolean> {
  const result = await new SimpleExecutor().execute({
    command: binaryPath,
    args: ['version', '--sha'],
    ignoreError: true,
  });
  if (result.exitCode !== 0) {
    logOutputChannel.debug(`Failed verifying CodeScene devtools binary: exit(${result.exitCode}) ${result.stderr}`);
    return false;
  }

  const isValid = result.stdout.trim() === requiredDevtoolsVersion;
  if (isValid) {
    logOutputChannel.debug(`Using CodeScene CLI version '${result.stdout}'.`);
  }
  return isValid;
}

/**
 * Get the bundled CodeScene devtools binary for the current platform and architecture.
 * The binary is bundled with the extension during the build process.
 */
export async function ensureCompatibleBinary(extensionPath: string): Promise<string> {
  logOutputChannel.info('Checking for bundled CodeScene devtools binary...');

  const binaryPath = getBundledBinaryPath(extensionPath);

  // Check if binary exists
  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `The devtools binary "${binaryPath}" does not exist. This should be bundled with the extension during the build process.`
    );
  }

  // Verify version
  const isValid = await verifyBinaryVersion(binaryPath);
  if (!isValid) {
    throw new Error(
      `The devtools binary version does not match the required version ${requiredDevtoolsVersion}. Please rebuild the extension.`
    );
  }

  logOutputChannel.info('CodeScene devtools binary is ready.');
  return binaryPath;
}
