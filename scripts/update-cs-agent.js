#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractZipArchive } = require('./extract-zip.js');

const projectRoot = path.join(__dirname, '..');
const targetDir = path.join(projectRoot, 'bin');
const pinPath = path.join(projectRoot, 'cs-agent.version');
const stampFileName = '.cs-agent-version';

const versionPattern = /^v?[0-9]+\.[0-9]+\.[0-9]+$/;
const osNames = { darwin: 'macos', linux: 'linux', win32: 'windows' };
const archNames = { x64: 'amd64', arm64: 'aarch64' };
const binaryNames = ['cs-agent', 'cs-agent.exe'];

function cleanVersionText(text) {
  return String(text)
    .replace(/^\uFEFF/, '')
    .trim();
}

function parseVersion(text, source) {
  const cleaned = cleanVersionText(text);
  if (!versionPattern.test(cleaned)) {
    throw new Error(`Invalid cs-agent version "${cleaned}" from ${source}: expected x.y.z or vx.y.z`);
  }
  return cleaned.replace(/^v/, '');
}

function resolveVersion(env, pinPath) {
  const override = cleanVersionText(env.CS_AGENT_VERSION ?? '');
  if (override !== '') {
    return parseVersion(override, 'CS_AGENT_VERSION');
  }
  if (!fs.existsSync(pinPath)) {
    throw new Error(`No cs-agent version: set CS_AGENT_VERSION or create cs-agent.version (${pinPath})`);
  }
  return parseVersion(fs.readFileSync(pinPath, 'utf8'), pinPath);
}

function artifactBaseName(platform, arch) {
  const osName = osNames[platform];
  const archName = archNames[arch];
  if (!osName || !archName || (platform === 'win32' && arch !== 'x64')) {
    throw new Error(`Unsupported platform/arch for cs-agent: ${platform}/${arch}`);
  }
  return `refactoring-agent-${osName}-${archName}`;
}

function assetName(platform, arch) {
  return `${artifactBaseName(platform, arch)}.zip`;
}

function archivedBinaryName(platform, arch) {
  return platform === 'win32' ? `${artifactBaseName(platform, arch)}.exe` : artifactBaseName(platform, arch);
}

function binaryName(platform) {
  return platform === 'win32' ? 'cs-agent.exe' : 'cs-agent';
}

function releaseTag(version) {
  return `v${version}`;
}

function stampValue(version, platform, arch) {
  return `${version} ${platform}-${arch}`;
}

function selectAsset(release, name, version) {
  const asset = Array.isArray(release?.assets)
    ? release.assets.find((candidate) => candidate.name === name)
    : undefined;
  if (!asset) {
    throw new Error(`cs-agent release ${releaseTag(version)} has no asset named ${name}`);
  }
  return asset;
}

function readStamp(dir) {
  try {
    return fs.readFileSync(path.join(dir, stampFileName), 'utf8').trim();
  } catch {
    return undefined;
  }
}

function isUpToDate(dir, version, platform, arch) {
  return readStamp(dir) === stampValue(version, platform, arch) && fs.existsSync(path.join(dir, binaryName(platform)));
}

function hasUnmanagedBinary(dir) {
  return readStamp(dir) === undefined && binaryNames.some((name) => fs.existsSync(path.join(dir, name)));
}

function removeInstalledBinaries(dir) {
  fs.rmSync(path.join(dir, stampFileName), { force: true });
  for (const name of binaryNames) {
    fs.rmSync(path.join(dir, name), { force: true });
  }
}

async function installBinary(zipPath, dir, version, platform, arch) {
  const extractDir = path.join(path.dirname(zipPath), 'extracted');
  await extractZipArchive(zipPath, extractDir);
  const extracted = path.join(extractDir, archivedBinaryName(platform, arch));
  if (!fs.existsSync(extracted)) {
    throw new Error(`cs-agent archive ${path.basename(zipPath)} has no ${archivedBinaryName(platform, arch)}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  removeInstalledBinaries(dir);
  const installed = path.join(dir, binaryName(platform));
  fs.copyFileSync(extracted, installed);
  fs.chmodSync(installed, 0o755);
  fs.writeFileSync(path.join(dir, stampFileName), `${stampValue(version, platform, arch)}\n`);
}

const releaseApiBase = 'https://api.github.com/repos/empear-analytics/cs-agent/releases';
const userAgent = 'codescene-vscode-update-cs-agent';

function httpError(res, step, what) {
  let message = `cs-agent ${step} failed for ${what}: HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) {
    message += '. The token may lack access to empear-analytics/cs-agent';
  }
  return new Error(message);
}

function requireToken(env, version) {
  const token = String(env.GITHUB_TOKEN ?? '').trim();
  if (token === '') {
    throw new Error(`GITHUB_TOKEN is required to download cs-agent ${version} from empear-analytics/cs-agent`);
  }
  return token;
}

async function fetchRelease(fetchImpl, headers, version) {
  const tag = releaseTag(version);
  const res = await fetchImpl(`${releaseApiBase}/tags/${tag}`, {
    headers: { ...headers, Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) {
    throw new Error(`Release ${tag} not found in empear-analytics/cs-agent (HTTP 404, release lookup)`);
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

async function fetchPinned({ env, pinPath, targetDir, platform, arch, force = false, fetchImpl = fetch, log = console.log }) {
  const version = resolveVersion(env, pinPath);
  const name = assetName(platform, arch);
  if (isUpToDate(targetDir, version, platform, arch)) {
    log(`cs-agent ${version} for ${platform}-${arch} is already present in ${targetDir}`);
    return;
  }
  if (!force && hasUnmanagedBinary(targetDir)) {
    log(`Keeping the locally built cs-agent in ${targetDir}; delete it or pass --force to download cs-agent ${version}`);
    return;
  }

  const headers = { Authorization: `token ${requireToken(env, version)}`, 'User-Agent': userAgent };
  log(`Downloading cs-agent ${version} (${name}) from empear-analytics/cs-agent...`);
  const asset = selectAsset(await fetchRelease(fetchImpl, headers, version), name, version);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-agent-'));
  try {
    const zipPath = path.join(tempDir, name);
    await downloadAsset(fetchImpl, headers, asset, zipPath);
    await installBinary(zipPath, targetDir, version, platform, arch);
    log(`cs-agent ${version} installed to ${path.join(targetDir, binaryName(platform))}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  return {
    platform: positional[0] ?? process.platform,
    arch: positional[1] ?? process.arch,
    force: argv.includes('--force'),
  };
}

async function main() {
  try {
    const { platform, arch, force } = parseArgs(process.argv.slice(2));
    await fetchPinned({ env: process.env, pinPath, targetDir, platform, arch, force });
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
  archivedBinaryName,
  binaryName,
  releaseTag,
  selectAsset,
  projectRoot,
  targetDir,
  pinPath,
  stampFileName,
  readStamp,
  isUpToDate,
  hasUnmanagedBinary,
  installBinary,
  fetchPinned,
  parseArgs,
};
