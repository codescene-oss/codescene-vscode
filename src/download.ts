// The strategy for downloading, and keeping the CodeScene devtools binary up to date, is as follows:
//
// 1. When the extension is activated, we check if the binary is already in it's expected location
//    and with the version matching the REQUIRED_DEVTOOLS_VERSION.
// 2. If not, we try to download it from downloads.codescene.io
//    Any errors along the way are presented in the status-view.

import extractZip from 'extract-zip';
import { https } from 'follow-redirects';
import * as fs from 'fs';
import * as path from 'path';
import { SimpleExecutor } from './executor';
import { logOutputChannel } from './log';

export class DownloadError extends Error {
  constructor(message: string, readonly url: URL, readonly expectedCliPath: string) {
    super(message);
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const REQUIRED_DEVTOOLS_VERSION = '4bbfed1b2a68783f54bc4da4e05c60ea2e4fe7c7';

const artifacts: { [platform: string]: { [arch: string]: string } } = {
  darwin: {
    x64: `cs-ide-macos-amd64-${REQUIRED_DEVTOOLS_VERSION}.zip`,
    arm64: `cs-ide-macos-aarch64-${REQUIRED_DEVTOOLS_VERSION}.zip`,
  },
  linux: {
    x64: `cs-ide-linux-amd64-${REQUIRED_DEVTOOLS_VERSION}.zip`,
    arm64: `cs-ide-linux-aarch64-${REQUIRED_DEVTOOLS_VERSION}.zip`,
  },
  win32: {
    x64: `cs-ide-windows-amd64-${REQUIRED_DEVTOOLS_VERSION}.zip`,
  },
};

class ArtifactInfo {
  constructor(readonly extensionPath: string) {}

  get absoluteDownloadPath() {
    return path.join(this.extensionPath, this.artifactName);
  }

  get absoluteBinaryPath() {
    return path.join(this.extensionPath, this.binaryName);
  }

  get artifactName() {
    const artifactName = artifacts[process.platform]?.[process.arch];
    if (!artifactName) {
      throw Error(`Unsupported platform: ${process.platform}-${process.arch}`);
    }
    return artifactName;
  }

  get binaryName(): string {
    // E.g. cs-darwin-x64/arm64, cs-linux-x64, cs-win32-x64.exe
    return `cs-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
  }
}

async function unzipFile({ absoluteDownloadPath, extensionPath, absoluteBinaryPath }: ArtifactInfo): Promise<void> {
  await extractZip(absoluteDownloadPath, { dir: extensionPath });
  fs.promises.unlink(absoluteDownloadPath).catch((e) => {
    logOutputChannel.warn(`Error trying to delete ${absoluteDownloadPath} after extracting:`, e);
  });

  // The zip file contains a single file named "cs-ide", or "cs-ide.exe" on Windows.
  // We rename it to the name of the executable for the current platform.
  const execFromZip = path.join(extensionPath, 'cs-ide' + (process.platform === 'win32' ? '.exe' : ''));
  await fs.promises.rename(execFromZip, absoluteBinaryPath);
}

async function ensureExecutable(filePath: string) {
  await fs.promises.chmod(filePath, '755');
}

function download({ artifactName: artifactDownloadName, absoluteDownloadPath, absoluteBinaryPath }: ArtifactInfo) {
  const url = new URL(`https://downloads.codescene.io/enterprise/cli/${artifactDownloadName}`);
  logOutputChannel.info(`Downloading ${url}`);

  return new Promise<void>((resolve, reject) => {
    https
      .get(url, { headers: { 'cache-control': 'max-age=0' } }, (response) => {
        if (response.statusCode === 200) {
          const writeStream = fs.createWriteStream(absoluteDownloadPath);
          response
            .on('end', () => {
              writeStream.close();
              logOutputChannel.debug('CodeScene devtools artifact downloaded to', absoluteDownloadPath);
              resolve();
            })
            .pipe(writeStream);
        } else {
          response.resume(); // Consume response to free up memory
          reject(
            new DownloadError(
              `Download error: [${response.statusCode}] ${response.statusMessage}.`,
              url,
              absoluteBinaryPath
            )
          );
        }
      })
      .on('error', (e) => {
        reject(new DownloadError(`Download error: ${e.message}.`, url, absoluteBinaryPath));
      })
      .end();
  });
}

/**
 * Verify that the binary matches the expected required version.
 * The throwOnError flag is used for propagating the error to the caller (present to user).
 */
async function verifyBinaryVersion({
  binaryPath,
  throwOnError = false,
}: {
  binaryPath: string;
  throwOnError?: boolean;
}) {
  const result = await new SimpleExecutor().execute({
    command: binaryPath,
    args: ['version', '--sha'],
    ignoreError: true,
  });
  if (result.exitCode !== 0) {
    if (throwOnError) throw new Error(`Error when verifying devtools binary version: ${result.stderr}`);
    logOutputChannel.info(`Failed verifying CodeScene devtools binary: exit(${result.exitCode}) ${result.stderr}`);
    return false;
  }

  return result.stdout.trim() === REQUIRED_DEVTOOLS_VERSION;
}

/**
 * Download the CodeScene devtools artifact for the current platform and architecture.
 */
export async function ensureCompatibleBinary(extensionPath: string): Promise<string> {
  logOutputChannel.info('Ensuring we have the current CodeScene devtools binary working on your system...');

  const artifactInfo = new ArtifactInfo(extensionPath);
  const binaryPath = artifactInfo.absoluteBinaryPath;

  if (await verifyBinaryVersion({ binaryPath })) return binaryPath;

  await download(artifactInfo);
  await unzipFile(artifactInfo);
  await ensureExecutable(binaryPath);

  if (fs.existsSync(binaryPath)) {
    await verifyBinaryVersion({ binaryPath, throwOnError: true });
    return binaryPath;
  } else {
    throw new Error(`The devtools binary "${binaryPath}" does not exist!`);
  }
}
