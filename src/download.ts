import { https } from 'follow-redirects';
import * as path from 'path';
import * as fs from 'fs';
import * as extractZip from 'extract-zip';

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

function getCliPath() {}

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

function download(url: string, filePath: string): Promise<void> {
  console.log(`Downloading codescene cli from ${url} to ${filePath}`);
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode === 200) {
          const writeStream = fs.createWriteStream(filePath);
          response
            .on('end', () => {
              writeStream.close();
              console.log('codescene cli artifact downloaded to', filePath);
              resolve();
            })
            .pipe(writeStream);
        } else {
          response.resume(); // Consume response to free up memory
          reject(new Error(`Error downloading codescene cli: ${response.statusMessage}`));
        }
      })
      .on('error', reject);
  });
}

/**
 * Download the CodeScene CLI artifact for the current platform and architecture.
 */
export async function ensureLatestCompatibleCliExists(extensionPath: string): Promise<string> {
  // For now, always do the download to make sure we have the latest version.
  // We will handle real versioning later.
  const cliPath = path.join(extensionPath, 'cs');

  // We only support x64 for now. Once we have arm64 support, we can start
  // using process.arch to determine the architecture.
  const artifactName = getArtifactDownloadName(process.platform, 'x64');

  if (!artifactName) {
    throw new Error(`Unsupported platform: ${process.platform} x64`);
  }

  const downloadUrl = getArtifactDownloadUrl(artifactName);
  const downloadPath = path.join(extensionPath, artifactName);

  await download(downloadUrl, downloadPath);
  await unzipFile(downloadPath, extensionPath);

  ensureExecutable(cliPath);

  if (fs.existsSync(cliPath)) {
    return cliPath;
  } else {
    throw new Error('Failed to download codescene cli');
  }
}
