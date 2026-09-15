import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cliConfig = require('../../scripts/cli-config.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bundleNativeCli } = require('../../scripts/bundle-native-cli');

export function nativeExecutablePath(extensionPath: string): string {
  return path.join(
    extensionPath,
    cliConfig.nativeDistributionName(process.platform, process.arch),
    cliConfig.nativeBinaryFileName(process.platform)
  );
}

export async function ensureNativeBinary(extensionPath = path.join(__dirname, '../..')): Promise<string> {
  const exePath = nativeExecutablePath(extensionPath);
  if (!fs.existsSync(exePath)) {
    await bundleNativeCli(process.platform, process.arch);
  }
  if (!fs.existsSync(exePath)) {
    throw new Error(`Native CLI not found at ${exePath}`);
  }
  return exePath;
}
