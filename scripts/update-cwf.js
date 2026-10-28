#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const extractZip = require('extract-zip');

const projectRoot = path.join(__dirname, '..');
const localCwfDir = path.join(projectRoot, '..', 'cs-webview');
const targetDir = path.join(projectRoot, 'cs-cwf');
const pinPath = path.join(projectRoot, 'cwf.version');

const versionPattern = /^v?[0-9]+\.[0-9]+\.[0-9]+$/;

function cleanVersionText(text) {
  return String(text)
    .replace(/^\uFEFF/, '')
    .trim();
}

function parseVersion(text, source) {
  const cleaned = cleanVersionText(text);
  if (!versionPattern.test(cleaned)) {
    throw new Error(`Invalid CWF version "${cleaned}" from ${source}: expected x.y.z or vx.y.z`);
  }
  return cleaned.replace(/^v/, '');
}

function resolveVersion(env, pinPath) {
  const override = cleanVersionText(env.CWF_VERSION ?? '');
  if (override !== '') {
    return parseVersion(override, 'CWF_VERSION');
  }
  if (!fs.existsSync(pinPath)) {
    throw new Error(`No CWF version: set CWF_VERSION or create cwf.version (${pinPath})`);
  }
  return parseVersion(fs.readFileSync(pinPath, 'utf8'), pinPath);
}

function assetName(version) {
  return `cs-webview-v${version}.zip`;
}

function releaseTag(version) {
  return `v${version}`;
}

function selectAsset(release, version) {
  const name = assetName(version);
  const asset = Array.isArray(release?.assets)
    ? release.assets.find((candidate) => candidate.name === name)
    : undefined;
  if (!asset) {
    throw new Error(`Release ${releaseTag(version)} has no asset named ${name}`);
  }
  return asset;
}

const requiredFiles = ['index.html', 'assets/index.js'];
const stampFileName = '.cwf-version';

function readStamp(dir) {
  try {
    return fs.readFileSync(path.join(dir, stampFileName), 'utf8').trim();
  } catch {
    return undefined;
  }
}

function writeStamp(dir, value) {
  fs.writeFileSync(path.join(dir, stampFileName), `${value}\n`);
}

function isUpToDate(dir, version) {
  return readStamp(dir) === version && requiredFiles.every((file) => fs.existsSync(path.join(dir, file)));
}

async function extractCwf(zipPath, dir) {
  fs.rmSync(path.join(dir, stampFileName), { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await extractZip(zipPath, { dir: path.resolve(dir) });
  const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(dir, file)));
  if (missing.length > 0) {
    throw new Error(`CWF archive is missing ${missing.map((file) => `cs-cwf/${file}`).join(', ')}`);
  }
}

const releaseApiBase = 'https://api.github.com/repos/empear-analytics/cs-webview/releases';
const userAgent = 'codescene-vscode-update-cwf';

function httpError(res, step, what) {
  let message = `CWF ${step} failed for ${what}: HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) {
    message += '. The token may lack access to empear-analytics/cs-webview';
  }
  return new Error(message);
}

function requireToken(env, version) {
  const token = String(env.GITHUB_TOKEN ?? '').trim();
  if (token === '') {
    throw new Error(`GITHUB_TOKEN is required to download CWF ${version} from empear-analytics/cs-webview`);
  }
  return token;
}

async function fetchRelease(fetchImpl, headers, version) {
  const tag = releaseTag(version);
  const res = await fetchImpl(`${releaseApiBase}/tags/${tag}`, {
    headers: { ...headers, Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) {
    throw new Error(`Release ${tag} not found in empear-analytics/cs-webview (HTTP 404, release lookup)`);
  }
  if (!res.ok) {
    throw httpError(res, 'release lookup', tag);
  }
  return res.json();
}

async function downloadAsset(fetchImpl, headers, asset, zipPath) {
  const res = await fetchImpl(asset.url, { headers: { ...headers, Accept: 'application/octet-stream' } });
  if (!res.ok) {
    throw httpError(res, 'asset download', asset.name);
  }
  await fs.promises.writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
}

async function fetchPinned({ env, pinPath, targetDir, fetchImpl = fetch, log = console.log }) {
  const version = resolveVersion(env, pinPath);
  if (isUpToDate(targetDir, version)) {
    log(`CWF ${version} is already present in ${targetDir}`);
    return;
  }

  const headers = { Authorization: `token ${requireToken(env, version)}`, 'User-Agent': userAgent };
  log(`Downloading CWF ${version} from empear-analytics/cs-webview...`);
  const asset = selectAsset(await fetchRelease(fetchImpl, headers, version), version);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cwf-'));
  try {
    const zipPath = path.join(tempDir, assetName(version));
    await downloadAsset(fetchImpl, headers, asset, zipPath);
    await extractCwf(zipPath, targetDir);
    writeStamp(targetDir, version);
    log(`CWF ${version} extracted to ${targetDir}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function shouldBuildLocally(env, localCwfDir) {
  return fs.existsSync(localCwfDir) && !env.CI;
}

function copyLocalBuild(buildDir, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(buildDir, targetDir, { recursive: true });
  writeStamp(targetDir, 'local');
}

function buildLocally() {
  console.log(`Building CWF locally from ${localCwfDir}...`);
  execSync('npm run build', { cwd: localCwfDir, stdio: 'inherit' });
  copyLocalBuild(path.join(localCwfDir, 'build'), targetDir);
  console.log(`CWF built and copied to ${targetDir}`);
}

async function main() {
  try {
    if (shouldBuildLocally(process.env, localCwfDir)) {
      buildLocally();
    } else {
      await fetchPinned({ env: process.env, pinPath, targetDir });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseVersion,
  resolveVersion,
  assetName,
  releaseTag,
  selectAsset,
  projectRoot,
  targetDir,
  pinPath,
  requiredFiles,
  stampFileName,
  readStamp,
  writeStamp,
  isUpToDate,
  extractCwf,
  fetchPinned,
  shouldBuildLocally,
  copyLocalBuild,
};
