#!/usr/bin/env node

/**
 * Fetch the CS IDE contract bundle (schemas, wire manifest and fixtures) the contract tests validate against.
 *
 * The bundle is published next to the CLI zips and keyed by the same SHA, so the pinned
 * requiredDevtoolsVersion in cli-config.js resolves it. It is unpacked to cs-ide-contract/.
 * Set CS_IDE_CONTRACT_BUNDLE to an unpacked bundle directory or a bundle zip to use that instead
 * of the download. Any failure (download, extraction, incomplete bundle) exits non-zero; the
 * tests never run without the bundle.
 */

const fs = require('fs');
const path = require('path');
const { downloadBinary } = require('./bundle-cli.js');
const { extractZipArchive } = require('./extract-zip.js');
const { contractArtifactName } = require('./cli-config.js');

const projectRoot = path.join(__dirname, '..');
const contractDirName = 'cs-ide-contract';

const requiredEntries = [
  { name: 'wire-manifest.json', isDirectory: false },
  { name: path.join('fixtures', 'index.json'), isDirectory: false },
  { name: 'schemas', isDirectory: true },
];

async function removePath(filePath) {
  await fs.promises.rm(filePath, { recursive: true, force: true });
}

function assertCompleteBundle(directory, source) {
  for (const { name, isDirectory } of requiredEntries) {
    const entryPath = path.join(directory, name);
    const found = fs.existsSync(entryPath) && fs.statSync(entryPath).isDirectory() === isDirectory;
    if (!found) {
      throw new Error(`${source} is not a contract bundle: ${name} is missing`);
    }
  }
}

async function stageLocalBundle(bundlePath, stagingDir) {
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`CS_IDE_CONTRACT_BUNDLE ${bundlePath} does not exist`);
  }
  if (fs.statSync(bundlePath).isDirectory()) {
    await fs.promises.cp(bundlePath, stagingDir, { recursive: true });
  } else {
    await extractZipArchive(bundlePath, stagingDir);
  }
}

async function stageDownloadedBundle(download, stagingDir) {
  const zipPath = await download(contractArtifactName());
  try {
    await extractZipArchive(zipPath, stagingDir);
  } finally {
    await removePath(zipPath);
  }
}

async function replaceDirectory(stagingDir, targetDir) {
  await removePath(targetDir);
  await fs.promises.rename(stagingDir, targetDir);
}

/**
 * Leaves a complete bundle in <root>/cs-ide-contract, or throws without touching an existing one.
 * `download` takes the artifact name and resolves to the downloaded zip path (bundle-cli.js's downloader).
 */
async function fetchContract({ env = process.env, root = projectRoot, download = downloadBinary } = {}) {
  const targetDir = path.join(root, contractDirName);
  const stagingDir = path.join(root, `.temp-extract-${contractDirName}`);
  const localBundle = (env.CS_IDE_CONTRACT_BUNDLE ?? '').trim();
  const source = localBundle || contractArtifactName();

  if (localBundle && path.resolve(localBundle) === path.resolve(targetDir)) {
    assertCompleteBundle(targetDir, source);
    return targetDir;
  }

  console.log(localBundle ? `Using contract bundle ${localBundle}...` : `Fetching ${source}...`);
  await removePath(stagingDir);
  try {
    if (localBundle) {
      await stageLocalBundle(localBundle, stagingDir);
    } else {
      await stageDownloadedBundle(download, stagingDir);
    }
    assertCompleteBundle(stagingDir, source);
    await replaceDirectory(stagingDir, targetDir);
  } finally {
    await removePath(stagingDir);
  }
  console.log(`✓ Contract bundle ready in ${contractDirName}/`);
  return targetDir;
}

if (require.main === module) {
  fetchContract().catch((error) => {
    console.error(`\n✗ Failed to fetch the contract bundle: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { fetchContract, assertCompleteBundle };
