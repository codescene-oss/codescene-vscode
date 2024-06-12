// The strategy for downloading, and keeping the CodeScene CLI up to date, is as follows:
//
// 1. When the extension is activated, we check if the CodeScene CLI is already in place.
// 2. If it is, we check if it is the latest version by issuing a HEAD request to the
//    download URL and comparing the last-modified header of the response with the response we
//    got when we last checked. The last response is stored in a file.
// 3. If a new CLI version has incompatible changes, the download URL will change, and
//    the extension won't accidentally try to download it until it's been updated to support the new
//    version.

import extractZip from 'extract-zip';
import { https } from 'follow-redirects';
import * as fs from 'fs';
import * as path from 'path';
import { SimpleExecutor } from './executor';
import { logOutputChannel, outputChannel } from './log';

// eslint-disable-next-line @typescript-eslint/naming-convention
const EXPECTED_CLI_VERSION = '9e5d10617b713fadd3fed61232efff2cea911d05';

const artifacts: { [platform: string]: { [arch: string]: string } } = {
  darwin: {
    x64: `codescene-cli-ide-macos-amd64-${EXPECTED_CLI_VERSION}.zip`,
    arm64: `codescene-cli-ide-macos-aarch64-${EXPECTED_CLI_VERSION}.zip`,
  },
  linux: {
    x64: `codescene-cli-ide-linux-amd64-${EXPECTED_CLI_VERSION}.zip`,
  },
  win32: {
    x64: `codescene-cli-ide-windows-amd64-${EXPECTED_CLI_VERSION}.zip`,
  },
};

function getArtifactDownloadName(process: NodeJS.Process) {
  const artifactName = artifacts[process.platform]?.[process.arch];
  if (!artifactName) {
    throw Error(`Unsupported platform: ${process.platform}-${process.arch}`);
  }
  return artifactName;
}

function getExecutableName(process: NodeJS.Process): string {
  // E.g. cs-darwin-x64/arm64, cs-linux-x64, cs-win32-x64.exe
  return `cs-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
}

async function unzipFile(zipFilePath: string, extensionPath: string, executablePath: string): Promise<void> {
  await extractZip(zipFilePath, { dir: extensionPath });
  fs.promises.unlink(zipFilePath).catch((e) => {
    logOutputChannel.warn(`Error trying to delete ${zipFilePath} after extracting:`, e);
  });

  // The zip file contains a single file named "cs", or "cs.exe" on Windows.
  // We rename it to the name of the executable for the current platform.
  const execFromZip = path.join(extensionPath, 'cs' + (process.platform === 'win32' ? '.exe' : ''));
  await fs.promises.rename(execFromZip, executablePath);
}

async function ensureExecutable(filePath: string) {
  await fs.promises.chmod(filePath, '755');
}

function download(url: URL, filePath: string) {
  outputChannel.appendLine(`Downloading ${url}`);

  return new Promise<void>((resolve, reject) => {
    https
      .get(url, { headers: { 'cache-control': 'max-age=0' } }, (response) => {
        if (response.statusCode === 200) {
          const writeStream = fs.createWriteStream(filePath);
          response
            .on('end', () => {
              writeStream.close();
              logOutputChannel.debug('CodeScene CLI artifact downloaded to', filePath);
              resolve();
            })
            .pipe(writeStream);
        } else {
          response.resume(); // Consume response to free up memory
          outputChannel.appendLine(`Error downloading ${url}: ${response.statusMessage}`);
          reject(new Error(`Error downloading CodeScene CLI: ${response.statusMessage}`));
        }
      })
      .on('error', reject)
      .end();
  });
}

/**
 * Simple sanity check using the version command to see if the binary actually runs
 *
 * @param cliPath
 * @returns
 */
async function ensureBinaryRuns(cliPath: string) {
  const result = await new SimpleExecutor().execute({ command: cliPath, args: ['version'], ignoreError: true }, {});
  if (result.exitCode !== 0) throw new Error(`Error invoking the CLI binary: ${result.stderr}`);
}

/**
 * Check the sha version using the version cmd, and compare with the currently expected cli version sha
 */
async function isExpectedCliVersion(cliPath: string) {
  const result = await new SimpleExecutor().execute({
    command: cliPath,
    args: ['version', '--sha'],
    ignoreError: true,
  });
  if (result.exitCode !== 0) return false;
  return result.stdout.trim() === EXPECTED_CLI_VERSION;
}

/**
 * Download the CodeScene CLI artifact for the current platform and architecture.
 */
export async function ensureCompatibleCli(extensionPath: string): Promise<string> {
  outputChannel.appendLine('Ensuring we have the current CodeScene CLI version working on your system...');

  const artifactName = getArtifactDownloadName(process);
  const executableName = getExecutableName(process);
  const cliPath = path.join(extensionPath, executableName);

  if (await isExpectedCliVersion(cliPath)) return cliPath;

  outputChannel.appendLine('CodeScene CLI missing or version mismatch, downloading required version');

  const downloadUrl = new URL(`https://downloads.codescene.io/enterprise/cli/${artifactName}`);
  const downloadPath = path.join(extensionPath, artifactName);
  await download(downloadUrl, downloadPath);
  await unzipFile(downloadPath, extensionPath, cliPath);
  await ensureExecutable(cliPath);

  if (fs.existsSync(cliPath)) {
    await ensureBinaryRuns(cliPath);
    return cliPath;
  } else {
    throw new Error(`The CodeScene CLI download "${cliPath}" does not exist`);
  }
}
