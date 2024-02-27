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
import { logOutputChannel, outputChannel } from './log';

const artifacts: { [platform: string]: { [arch: string]: string } } = {
  darwin: {
    x64: 'codescene-cli-ide-macos-amd64-v3.zip',
    arm64: 'codescene-cli-ide-macos-aarch64-v3.zip',
  },
  linux: {
    x64: 'codescene-cli-ide-linux-amd64-v3.zip',
  },
  win32: {
    x64: 'codescene-cli-ide-windows-amd64-v3.zip',
  },
};

function getArtifactDownloadName(platform: NodeJS.Platform, arch: string): string | undefined {
  return artifacts[platform]?.[arch];
}

function getExecutableName(platform: NodeJS.Platform, arch: string): string {
  // E.g. cs-darwin-x64/arm64, cs-linux-x64, cs-win32-x64.exe
  return `cs-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`;
}

function getArtifactDownloadUrl(artifactName: string): URL {
  return new URL(`https://downloads.codescene.io/enterprise/cli/${artifactName}`);
}

async function unzipFile(zipFilePath: string, extensionPath: string, executablePath: string): Promise<void> {
  await extractZip(zipFilePath, { dir: extensionPath });
  await fs.promises.unlink(zipFilePath);

  // The zip file contains a single file named "cs", or "cs.exe" on Windows.
  // We rename it to the name of the executable for the current platform.
  const execFromZip = path.join(extensionPath, 'cs' + (process.platform === 'win32' ? '.exe' : ''));
  await fs.promises.rename(execFromZip, executablePath);
}

async function ensureExecutable(filePath: string) {
  await fs.promises.chmod(filePath, '755');
}

function checkRemoteLastModifiedDate(url: URL) {
  // Issue a HTTP HEAD request to check the last-modified header of the artifact.
  logOutputChannel.debug(`Checking last-modified header of ${url.href}`);

  return new Promise<Date | null>((resolve) => {
    https
      .request(url, { method: 'HEAD' }, (response) => {
        if (response.statusCode === 200) {
          const lastModified = response.headers['last-modified'];
          if (lastModified) {
            resolve(new Date(lastModified));
            return;
          }
        }
        resolve(null);
      })
      .on('error', (e) => {
        logOutputChannel.debug('Error while checking last-modified header:', e);
        resolve(null);
      })
      .end();
  });
}

// Read "cs.last-modified" file and return the date it contains.
async function checkLocalLastModifiedDate(lastModifiedPath: string) {
  try {
    const contents = await fs.promises.readFile(lastModifiedPath);
    return new Date(contents.toString());
  } catch (e) {
    return null;
  }
}

async function isUpToDate(cliPath: string, lastModifiedPath: string, url: URL) {
  // If the local copy does not exist, it's obviously not up to date.
  if (!fs.existsSync(cliPath)) {
    return false;
  }

  const remoteDate = await checkRemoteLastModifiedDate(url);
  const localDate = await checkLocalLastModifiedDate(lastModifiedPath);

  if (remoteDate === null) {
    // We can't trust the remote, so we'll just assume the local version is up to date.
    logOutputChannel.debug(
      'Could not check last-modified header of remote artifact, assuming local copy is up to date'
    );
    return true;
  }

  if (localDate === null) {
    // We don't have a local date, so the local copy can't be up to date.
    logOutputChannel.debug(
      'Could not check last-modified date of local artifact, assuming local copy is not up to date'
    );
    return false;
  }

  return localDate >= remoteDate;
}

async function updateLocalLastModifiedDate(filePath: string, date: Date) {
  await fs.promises.writeFile(filePath, date.toString());
}

function download(url: URL, filePath: string) {
  outputChannel.appendLine(`Downloading ${url}`);

  return new Promise<Date | null>((resolve, reject) => {
    https
      .get(url, { headers: { 'cache-control': 'max-age=0' } }, (response) => {
        if (response.statusCode === 200) {
          const writeStream = fs.createWriteStream(filePath);
          response
            .on('end', () => {
              writeStream.close();
              logOutputChannel.debug('CodeScene cli artifact downloaded to', filePath);
              const lastModified = response.headers['last-modified'];
              if (lastModified) {
                resolve(new Date(lastModified));
              }
              resolve(null);
            })
            .pipe(writeStream);
        } else {
          response.resume(); // Consume response to free up memory
          outputChannel.appendLine(`Error downloading ${url}: ${response.statusMessage}`);
          reject(new Error(`Error downloading codescene CLI: ${response.statusMessage}`));
        }
      })
      .on('error', reject)
      .end();
  });
}

export interface CliStatus {
  cliPath?: string;
  error?: string;
}

/**
 * Download the CodeScene CLI artifact for the current platform and architecture.
 */
export async function ensureLatestCompatibleCliExists(extensionPath: string): Promise<CliStatus> {
  outputChannel.appendLine('Ensuring we have the latest CodeScene CLI version...');

  const executableName = getExecutableName(process.platform, process.arch);
  const cliPath = path.join(extensionPath, executableName);
  const lastModifiedPath = path.join(extensionPath, executableName + '.last-modified');

  const artifactName = getArtifactDownloadName(process.platform, process.arch);

  if (!artifactName) {
    const error = `Unsupported platform: ${process.platform}-${process.arch}`;
    outputChannel.appendLine(error);
    return { error };
  }

  const downloadUrl = getArtifactDownloadUrl(artifactName);

  if (await isUpToDate(cliPath, lastModifiedPath, downloadUrl)) {
    outputChannel.appendLine('CodeScene CLI already exists and is up to date');
    return { cliPath };
  }

  outputChannel.appendLine('CodeScene CLI is not up to date, downloading latest version');

  const downloadPath = path.join(extensionPath, artifactName);
  const lastModified = await download(downloadUrl, downloadPath);
  await unzipFile(downloadPath, extensionPath, cliPath);
  await ensureExecutable(cliPath);

  if (lastModified) {
    await updateLocalLastModifiedDate(lastModifiedPath, lastModified);
  }

  if (fs.existsSync(cliPath)) {
    outputChannel.appendLine('The latest CodeScene CLI is in place, we are ready to go!');
    return { cliPath };
  } else {
    const error = 'Failed to download codescene cli';
    outputChannel.appendLine(error);
    return { error };
  }
}
