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
    x64: 'codescene-cli-macos-amd64.zip',
  },
  linux: {
    x64: 'codescene-cli-linux-amd64.zip',
  },
  win32: {
    x64: 'codescene-cli-windows-amd64.zip',
  },
};

function getArtifactDownloadName(platform: string, arch: string): string | undefined {
  return artifacts[platform]?.[arch];
}

function getArtifactDownloadUrl(artifactName: string): string {
  return `https://downloads.codescene.io/enterprise/cli/${artifactName}`;
}

async function unzipFile(zipFilePath: string, extensionPath: string): Promise<void> {
  console.log('Unzipping file');
  return extractZip(zipFilePath, { dir: extensionPath });
}

function ensureExecutable(filePath: string) {
  console.log('Ensuring file is executable');
  fs.chmodSync(filePath, '755');
}

function checkRemoteLastModifiedDate(url: string) {
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

async function isUpToDate(cliPath: string, lastModifiedPath: string, url: string) {
  // If the local copy does not exist, it's obviously not up to date.
  if (!fs.existsSync(cliPath)) {
    return false;
  }

  const remoteDate = await checkRemoteLastModifiedDate(url);
  const localDate = await checkLocalLastModifiedDate(lastModifiedPath);

  if (remoteDate === null) {
    // We can't trust the remote, so we'll just assume the local version is up to date.
    return true;
  }

  if (localDate === null) {
    // We don't have a local date, so the local copy can't be up to date.
    return false;
  }

  return localDate >= remoteDate;
}

async function updateLocalLastModifiedDate(filePath: string, date: string) {
  await fs.promises.writeFile(filePath, date);
}

function download(url: string, filePath: string) {
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

  const cliPath = path.join(extensionPath, process.platform === 'win32' ? 'cs.exe' : 'cs');
  const lastModifiedPath = path.join(extensionPath, 'cs.last-modified');

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
  await unzipFile(downloadPath, extensionPath);
  ensureExecutable(cliPath);

  if (lastModified) {
    await updateLocalLastModifiedDate(lastModifiedPath, lastModified.toString());
  }

  if (fs.existsSync(cliPath)) {
    outputChannel.appendLine('The latest CodeScene CLI is in place, we are ready to go!');
    return cliPath;
  } else {
    throw new Error('Failed to download codescene cli');
  }
}
