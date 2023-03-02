// The strategy for downloading, and keeping the CodeScene CLI up to date, is as follows:
//
// 1. When the extension is activated, we check if the CodeScene CLI is already in place.
// 2. If it is, we check if it is the latest version by issuing a HEAD request to the
//    download URL and comparing the last-modified header of the response with the response we
//    got when we last checked. The last response is stored in a file.
// 3. If a new CLI version has incompatible changes, the download URL will change, and
//    the extension won't accidentally try to download it until it's been updated to support the new
//    version.

import { https } from 'follow-redirects';
import * as path from 'path';
import * as fs from 'fs';
import * as extractZip from 'extract-zip';
import { outputChannel } from './log';

const artifacts: { [platform: string]: { [arch: string]: string } } = {
  darwin: {
    x64: 'codescene-cli-macos-amd64-v1.zip',
  },
  linux: {
    x64: 'codescene-cli-linux-amd64-v1.zip',
  },
  win32: {
    x64: 'codescene-cli-windows-amd64-v1.zip',
  },
};

function getArtifactDownloadName(platform: NodeJS.Platform, arch: string): string | undefined {
  return artifacts[platform]?.[arch];
}

function getExecutableName(platform: NodeJS.Platform, arch: 'x64'): string {
  // E.g. cs-darwin-x64, cs-linux-x64, cs-win32-x64.exe
  return `cs-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`;
}

function getArtifactDownloadUrl(artifactName: string): URL {
  return new URL(`https://downloads.codescene.io/enterprise/cli/${artifactName}`);
}

async function unzipFile(zipFilePath: string, extensionPath: string, executablePath: string): Promise<void> {
  console.log('Unzipping file');
  await extractZip(zipFilePath, { dir: extensionPath });
  // The zip file contains a single file named "cs", or "cs.exe" on Windows.
  // We rename it to the name of the executable for the current platform.
  const execFromZip = path.join(extensionPath, 'cs' + (process.platform === 'win32' ? '.exe' : ''));
  await fs.promises.rename(execFromZip, executablePath);
}

async function ensureExecutable(filePath: string) {
  console.log('Ensuring file is executable');
  await fs.promises.chmod(filePath, '755');
}

function checkRemoteLastModifiedDate(url: URL) {
  // Issue a HTTP HEAD request to check the last-modified header of the artifact.
  console.log('CodeScene: checking last-modified header of', url, '...');

  return new Promise<Date | null>((resolve) => {
    https.request(url, {method: 'HEAD'}, (response) => {
      if (response.statusCode === 200) {
        const lastModified = response.headers['last-modified'];
        if (lastModified ) {
          resolve(new Date(lastModified));
          return;
        }
      }
      resolve(null);
    })
    .on('error', e => {
      console.log('CodeScene: error while checking last-modified header:', e);
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
    console.log('CodeScene: could not check last-modified header of remote artifact, assuming local copy is up to date');
    return true;
  }

  if (localDate === null) {
    // We don't have a local date, so the local copy can't be up to date.
    console.log('CodeScene: could not check last-modified date of local artifact, assuming local copy is not up to date');
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
      .get(url, {headers: {"cache-control": "max-age=0"}}, (response) => {
        if (response.statusCode === 200) {
          const writeStream = fs.createWriteStream(filePath);
          response
            .on('end', () => {
              writeStream.close();
              console.log('codescene cli artifact downloaded to', filePath);
              const lastModified = response.headers['last-modified'];
              if (lastModified) {
                resolve(new Date(lastModified));
              }
              resolve(null);
            })
            .pipe(writeStream);
        } else {
          response.resume(); // Consume response to free up memory
          reject(new Error(`Error downloading codescene cli: ${response.statusMessage}`));
        }
      })
      .on('error', reject)
      .end();
  });
}

/**
 * Download the CodeScene CLI artifact for the current platform and architecture.
 */
export async function ensureLatestCompatibleCliExists(extensionPath: string): Promise<string> {
  outputChannel.appendLine('Ensuring we have the latest CodeScene CLI version...');

  const executableName = getExecutableName(process.platform, 'x64');
  const cliPath = path.join(extensionPath, executableName);
  const lastModifiedPath = path.join(extensionPath, executableName + '.last-modified');

  // We only support x64 for now. Once we have arm64 support, we can start
  // using process.arch to determine the architecture.
  const artifactName = getArtifactDownloadName(process.platform, 'x64');

  if (!artifactName) {
    throw new Error(`Unsupported platform: ${process.platform} x64`);
  }

  const downloadUrl = getArtifactDownloadUrl(artifactName);

  if (await isUpToDate(cliPath, lastModifiedPath, getArtifactDownloadUrl(artifactName))) {
    outputChannel.appendLine('CodeScene CLI already exists and is up to date');
    return cliPath;
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
    return cliPath;
  } else {
    throw new Error('Failed to download codescene cli');
  }
}
