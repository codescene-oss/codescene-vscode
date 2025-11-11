#!/usr/bin/env node

/**
 * Bundle CLI binaries for a specific platform/architecture.
 * This script downloads the required CLI binary and extracts it to the project root
 * so it can be included in the VSIX package.
 */

const { https } = require('follow-redirects');
const fs = require('fs');
const path = require('path');
const extractZip = require('extract-zip');

const REQUIRED_DEVTOOLS_VERSION = '5e1b0e99b868bc94da2c39514fd7b8e731406bb1';

const artifacts = {
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

function getBinaryName(platform, arch) {
  return `cs-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`;
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
              fs.unlinkSync(filePath).catch(() => {});
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

async function extractBinary(zipPath, platform, arch) {
  const projectRoot = path.join(__dirname, '..');
  // Extract to a unique temporary directory to avoid race conditions when extracting in parallel
  const tempExtractDir = path.join(projectRoot, `.temp-extract-${platform}-${arch}`);
  console.log(`Extracting ${path.basename(zipPath)}...`);

  try {
    // Create temporary directory
    await fs.promises.mkdir(tempExtractDir, { recursive: true });

    // Extract zip to temporary directory
    await extractZip(zipPath, { dir: tempExtractDir });

    // Find the extracted binary (should be cs-ide or cs-ide.exe)
    const execFromZip = path.join(tempExtractDir, 'cs-ide' + (platform === 'win32' ? '.exe' : ''));
    const targetBinary = path.join(projectRoot, getBinaryName(platform, arch));

    if (!fs.existsSync(execFromZip)) {
      throw new Error(`Expected binary not found after extraction: ${execFromZip}`);
    }

    // Move binary to final location
    await fs.promises.rename(execFromZip, targetBinary);
    console.log(`✓ Extracted to ${path.basename(targetBinary)}`);

    // Make executable on Unix systems
    if (platform !== 'win32') {
      await fs.promises.chmod(targetBinary, '755');
    }
  } finally {
    // Clean up temporary directory
    try {
      // Use rm with recursive option (Node 14.14.0+), fallback to rmdir for older versions
      if (fs.promises.rm) {
        await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
      } else {
        await fs.promises.rmdir(tempExtractDir, { recursive: true });
      }
    } catch (e) {
      // Ignore cleanup errors
    }
    // Clean up zip file
    try {
      await fs.promises.unlink(zipPath);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

async function bundleBinaryForPlatform(platform, arch) {
  const artifactName = artifacts[platform]?.[arch];
  if (!artifactName) {
    throw new Error(`Unsupported platform/arch combination: ${platform}/${arch}`);
  }

  console.log(`Bundling CLI binary for ${platform}/${arch}...\n`);

  try {
    const zipPath = await downloadBinary(artifactName);
    await extractBinary(zipPath, platform, arch);
    console.log(`\n✓ Successfully bundled ${platform}/${arch} binary!`);
  } catch (error) {
    console.error(`\n✗ Failed to bundle ${platform}/${arch}:`, error.message);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Check if platform and arch are provided as arguments
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

module.exports = { bundleBinaryForPlatform };




