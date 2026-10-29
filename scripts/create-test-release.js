#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const versionIncrementers = new Map([
  ['patch', ([major, minor, patch]) => [major, minor, patch + 1]],
  ['minor', ([major, minor]) => [major, minor + 1, 0]],
  ['major', ([major]) => [major + 1, 0, 0]],
]);
const supportedBumps = [...versionIncrementers.keys()];

function assertSupportedBump(bump) {
  if (!versionIncrementers.has(bump)) {
    throw new Error(`Expected patch, minor, or major, got ${bump}.`);
  }
}

function parseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) {
    throw new Error(`Expected package version in x.y.z format, got ${version}.`);
  }
  const components = match.slice(1).map(Number);
  if (!components.every(Number.isSafeInteger)) {
    throw new Error(`Expected package version in x.y.z format, got ${version}.`);
  }
  return components;
}

function formatVersion(components) {
  const nextVersion = components;
  if (!nextVersion.every(Number.isSafeInteger)) {
    const error = new Error(`Version increment must remain within JavaScript's safe integer range.`);
    error.code = 'VERSION_OVERFLOW';
    throw error;
  }
  return nextVersion.join('.');
}

function incrementVersion(version, bump) {
  assertSupportedBump(bump);
  return formatVersion(versionIncrementers.get(bump)(parseVersion(version)));
}

function tryIncrementVersion(version, bump) {
  try {
    return incrementVersion(version, bump);
  } catch (error) {
    if (error.code === 'VERSION_OVERFLOW') {
      return undefined;
    }
    throw error;
  }
}

function isNextVersion(currentVersion, candidateVersion) {
  return supportedBumps.map((bump) => tryIncrementVersion(currentVersion, bump)).includes(candidateVersion);
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function ensureCleanWorktree(cwd) {
  if (git(cwd, 'status', '--porcelain')) {
    throw new Error('Test releases require a clean git worktree.');
  }
}

function ensureTagMissing(cwd, tag) {
  if (git(cwd, 'tag', '--list', tag)) {
    throw new Error(`Tag already exists: ${tag}`);
  }
}

function createTestRelease(cwd, bump = 'patch') {
  assertSupportedBump(bump);
  ensureCleanWorktree(cwd);
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const baseVersion = incrementVersion(packageJson.version, bump);
  const shortSha = git(cwd, 'rev-parse', '--short=7', 'HEAD');
  const version = `${baseVersion}-test.${shortSha}`;
  const tag = `v${version}`;
  ensureTagMissing(cwd, tag);
  git(cwd, 'tag', '-a', tag, '-m', `Test release ${version}`);
  return { tag, version };
}

function parseBumpArguments(args) {
  if (args.length === 0) {
    return 'patch';
  }
  if (args.length !== 1) {
    throw new Error('Expected zero or one bump argument: patch, minor, or major.');
  }
  const [bump] = args;
  if (!bump) {
    throw new Error('Expected zero or one bump argument: patch, minor, or major.');
  }
  return bump;
}

function main() {
  try {
    const bump = parseBumpArguments(process.argv.slice(2));
    const { tag } = createTestRelease(process.cwd(), bump);
    console.log(`Created test release tag ${tag}.`);
    console.log(`Push with: git push origin ${tag}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createTestRelease,
  incrementVersion,
  isNextVersion,
  parseBumpArguments,
  parseVersion,
};
