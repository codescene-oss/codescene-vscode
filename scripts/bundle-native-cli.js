#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  nativeArtifactName,
  nativeDistributionName,
  nativeBinaryFileName,
} = require('./cli-config.js');
const { downloadBinary, extractZipArchive, removePath } = require('./bundle-cli.js');

function nativeDistributionPath(platform, arch) {
  return path.join(__dirname, '..', nativeDistributionName(platform, arch));
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

async function installNativeBinary(extractDir, platform, arch) {
  const binaryPath = locateNativeBinary(extractDir, platform);
  const targetDir = nativeDistributionPath(platform, arch);
  await removePath(targetDir);
  await fs.promises.mkdir(targetDir, { recursive: true });
  const targetBinary = path.join(targetDir, nativeBinaryFileName(platform));
  await fs.promises.copyFile(binaryPath, targetBinary);
  const runtimeDll = path.join(path.dirname(binaryPath), 'vcruntime140.dll');
  if (fs.existsSync(runtimeDll)) {
    await fs.promises.copyFile(runtimeDll, path.join(targetDir, 'vcruntime140.dll'));
  }
  if (platform !== 'win32') {
    await fs.promises.chmod(targetBinary, '755');
  }
  console.log(`✓ Extracted native CLI to ${path.basename(targetDir)}`);
  return targetBinary;
}

async function extractNativeDistribution(zipPath, platform, arch) {
  const projectRoot = path.join(__dirname, '..');
  const tempExtractDir = path.join(projectRoot, `.temp-native-extract-${platform}-${arch}`);
  console.log(`Extracting ${path.basename(zipPath)}...`);

  try {
    await fs.promises.mkdir(tempExtractDir, { recursive: true });
    await extractZipArchive(zipPath, tempExtractDir);
    return await installNativeBinary(tempExtractDir, platform, arch);
  } finally {
    await removePath(tempExtractDir);
    await removePath(zipPath);
  }
}

async function bundleNativeCli(platform = process.platform, arch = process.arch) {
  const artifactName = nativeArtifactName(platform, arch);
  const url = `https://downloads.codescene.io/enterprise/cli/${artifactName}`;
  console.log(`Bundling native CLI for ${platform}/${arch}...\n`);

  try {
    const existing = path.join(nativeDistributionPath(platform, arch), nativeBinaryFileName(platform));
    if (fs.existsSync(existing)) {
      console.log(`✓ Using existing ${path.basename(path.dirname(existing))} native CLI`);
      return existing;
    }
    const zipPath = await downloadBinary(artifactName);
    const binaryPath = await extractNativeDistribution(zipPath, platform, arch);
    console.log(`\n✓ Successfully bundled native ${platform}/${arch} CLI!`);
    return binaryPath;
  } catch (error) {
    console.error(`\n✗ Failed to bundle native ${platform}/${arch}:`, error.message);
    console.error(`Tried ${url}`);
    throw error;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const platform = args[0] || process.platform;
  const arch = args[1] || process.arch;
  bundleNativeCli(platform, arch)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Error:', error.message);
      process.exit(1);
    });
}

module.exports = {
  bundleNativeCli,
  locateNativeBinary,
  nativeDistributionPath,
};
