#!/usr/bin/env node

/**
 * Bundle CLI distributions for a specific platform/architecture.
 * This script downloads the required CLI distribution and extracts it to the project root
 * so it can be included in the VSIX package.
 */

const { https } = require('follow-redirects');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const extractZip = require('extract-zip');
const { artifacts, nativeBinaryFileName, requiredSidecarFileNames } = require('./cli-config.js');

const execFileAsync = promisify(execFile);

function getDistributionName(platform, arch) {
  return `cs-${platform}-${arch}`;
}

function localDistributionPath(platform, arch) {
  return path.join(__dirname, '..', getDistributionName(platform, arch));
}

function downloadBinary(artifactName) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://downloads.codescene.io/enterprise/cli/${artifactName}`);
    console.log(`Downloading ${url}...`);

    https
      .get(url, { headers: { 'cache-control': 'max-age=0' } }, (response) => {
        if (response.statusCode === 200) {
          const filePath = path.join(__dirname, '..', artifactName);
          const writeStream = fs.createWriteStream(filePath);
          response
            .on('end', () => {
              writeStream.close();
              console.log(`✓ Downloaded ${artifactName}`);
              resolve(filePath);
            })
            .on('error', (e) => {
              writeStream.close();
              try {
                fs.unlinkSync(filePath);
              } catch (unlinkError) {
                // Ignore cleanup errors
              }
              reject(new Error(`Download error: ${e.message}`));
            })
            .pipe(writeStream);
        } else {
          response.resume();
          reject(new Error(`Download error: [${response.statusCode}] ${response.statusMessage}`));
        }
      })
      .on('error', (e) => {
        reject(new Error(`Download error: ${e.message}`));
      })
      .end();
  });
}

function locateNativeBinary(extractDir, platform) {
  const fileName = nativeBinaryFileName(platform);
  const atRoot = path.join(extractDir, fileName);
  if (fs.existsSync(atRoot)) return atRoot;

  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length === 1) {
    const nested = path.join(extractDir, directories[0].name, fileName);
    if (fs.existsSync(nested)) return nested;
  }

  throw new Error(`Expected native ${fileName} not found after extraction: ${extractDir}`);
}

function locateRequiredSidecars(binaryPath, platform) {
  const directory = path.dirname(binaryPath);
  return requiredSidecarFileNames(platform).map((fileName) => {
    const sidecarPath = path.join(directory, fileName);
    if (!fs.existsSync(sidecarPath)) {
      throw new Error(`Expected ${fileName} alongside the native binary: ${directory}`);
    }
    return sidecarPath;
  });
}

function validateDistribution(distributionPath, platform) {
  const exe = path.join(distributionPath, nativeBinaryFileName(platform));
  if (!fs.existsSync(exe)) {
    throw new Error(`Expected native ${nativeBinaryFileName(platform)} not found: ${distributionPath}`);
  }
  locateRequiredSidecars(exe, platform);
}

function useLocalDistribution(platform, arch) {
  if (process.env.CS_IDE_USE_LOCAL_DISTRIBUTION !== 'true') return false;
  const distributionPath = localDistributionPath(platform, arch);
  validateDistribution(distributionPath, platform);
  console.log(`✓ Using local ${path.basename(distributionPath)} distribution`);
  return true;
}

async function installNativeDistribution(extractDir, targetDistribution, platform) {
  const binaryPath = locateNativeBinary(extractDir, platform);
  const sidecarPaths = locateRequiredSidecars(binaryPath, platform);
  const staging = `${targetDistribution}.new`;
  const backupDistribution = `${targetDistribution}.old`;
  const fileName = nativeBinaryFileName(platform);
  await removePath(staging);
  await fs.promises.mkdir(staging, { recursive: true });
  await fs.promises.copyFile(binaryPath, path.join(staging, fileName));
  for (const sidecarPath of sidecarPaths) {
    await fs.promises.copyFile(sidecarPath, path.join(staging, path.basename(sidecarPath)));
  }
  const runtimeDll = path.join(path.dirname(binaryPath), 'vcruntime140.dll');
  if (fs.existsSync(runtimeDll)) {
    await fs.promises.copyFile(runtimeDll, path.join(staging, 'vcruntime140.dll'));
  }
  if (platform !== 'win32') {
    await fs.promises.chmod(path.join(staging, fileName), '755');
  }

  await removePath(backupDistribution);
  if (fs.existsSync(targetDistribution)) {
    await fs.promises.rename(targetDistribution, backupDistribution);
  }
  try {
    await fs.promises.rename(staging, targetDistribution);
  } catch (error) {
    if (fs.existsSync(backupDistribution) && !fs.existsSync(targetDistribution)) {
      await fs.promises.rename(backupDistribution, targetDistribution);
    }
    throw error;
  }
  await removePath(backupDistribution);
  console.log(`✓ Extracted to ${path.basename(targetDistribution)}`);
}

async function removePath(filePath) {
  try {
    await fs.promises.rm(filePath, { recursive: true, force: true });
  } catch (e) {}
}

async function extractZipArchive(zipPath, destinationDir) {
  // Windows CI publishes zips via Compress-Archive; extract-zip/yauzl can stop early on those.
  if (process.platform === 'win32') {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    );
    return;
  }
  await extractZip(zipPath, { dir: destinationDir });
}

async function extractDistribution(zipPath, platform, arch) {
  const projectRoot = path.join(__dirname, '..');
  const tempExtractDir = path.join(projectRoot, `.temp-extract-${platform}-${arch}`);
  console.log(`Extracting ${path.basename(zipPath)}...`);

  try {
    await fs.promises.mkdir(tempExtractDir, { recursive: true });
    await extractZipArchive(zipPath, tempExtractDir);

    const targetDistribution = path.join(projectRoot, getDistributionName(platform, arch));
    await installNativeDistribution(tempExtractDir, targetDistribution, platform);
  } finally {
    await removePath(tempExtractDir);
    await removePath(zipPath);
  }
}

async function bundleBinaryForPlatform(platform, arch) {
  const artifactName = artifacts[platform]?.[arch];
  if (!artifactName) {
    throw new Error(`Unsupported platform/arch combination: ${platform}/${arch}`);
  }

  console.log(`Bundling CLI binary for ${platform}/${arch}...\n`);

  try {
    if (useLocalDistribution(platform, arch)) return;
    const zipPath = await downloadBinary(artifactName);
    await extractDistribution(zipPath, platform, arch);
    console.log(`\n✓ Successfully bundled ${platform}/${arch} distribution!`);
  } catch (error) {
    console.error(`\n✗ Failed to bundle ${platform}/${arch}:`, error.message);
    throw error;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length >= 2) {
    const platform = args[0];
    const arch = args[1];
    bundleBinaryForPlatform(platform, arch)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('Error:', error.message);
        process.exit(1);
      });
  } else {
    console.error('Usage: node bundle-cli.js <platform> <arch>');
    console.error('Example: node bundle-cli.js darwin arm64');
    process.exit(1);
  }
}

module.exports = { bundleBinaryForPlatform, locateNativeBinary, locateRequiredSidecars };
