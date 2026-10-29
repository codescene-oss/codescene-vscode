#!/usr/bin/env node

const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const { isNextVersion, parseVersion } = require('./create-test-release');

const tagPattern = /^v([^-]+)(?:-test\.([0-9a-f]*))?$/;
const shaPattern = /^[0-9a-f]{7,40}$/;
const usage = [
  'Usage: release-flow.js <',
  'classify <tag>',
  ' | is-next-version <current> <candidate>',
  ' | compose-notes <is_test> <stable_tag> <tag> <server_url> <repository>',
  ' | vsix-files <version> <full|noace|all> <dir>',
  ' | missing-assets <existing-names-file> <paths...>',
  ' | test-gate <sha>',
  ' | publish-marketplace <files...>',
  ' | record-version <version>',
  ' | promotion <tag> [<latest>]',
  '>',
].join('');
const vsixTargets = ['darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64'];
const vsixVariants = [
  ['full', 'codescene-vscode'],
  ['noace', 'codescene-vscode-noace'],
];

function malformedTagError(tag) {
  return new Error(`Expected vX.Y.Z or vX.Y.Z-test.<commit-sha>, got ${tag}.`);
}

function classifyTag(tag) {
  const match = tagPattern.exec(tag);
  if (!match) {
    throw malformedTagError(tag);
  }
  const [, baseVersion, sha] = match;
  try {
    parseVersion(baseVersion);
  } catch {
    throw malformedTagError(tag);
  }
  if (sha === undefined) {
    return { kind: 'stable', version: baseVersion };
  }
  if (!shaPattern.test(sha)) {
    throw new Error(`Test tag commit sha must be 7 to 40 lowercase hex digits, got ${tag}.`);
  }
  return { kind: 'test', version: `${baseVersion}-test.${sha}`, baseVersion, sha };
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return left[i] < right[i] ? -1 : 1;
    }
  }
  return 0;
}

function stableVersion(tag) {
  const classification = classifyTag(tag);
  if (classification.kind !== 'stable') {
    throw new Error(`Expected a stable vX.Y.Z tag, got ${tag}.`);
  }
  return classification.version;
}

function promotionAction(tag, latestTag) {
  const version = stableVersion(tag);
  if (!latestTag) {
    return 'promote';
  }
  const order = compareVersions(version, stableVersion(latestTag));
  if (order === 0) {
    return 'unchanged';
  }
  return order > 0 ? 'promote' : 'superseded';
}

function formatClassification({ kind, version, baseVersion = '', sha = '' }) {
  return [`kind=${kind}`, `version=${version}`, `base_version=${baseVersion}`, `test_sha=${sha}`].join('\n');
}

function composeReleaseNotes({ isTest, stableTag, tag, serverUrl, repository, generated }) {
  if (!isTest || !stableTag) {
    return generated;
  }
  const compareUrl = `${serverUrl}/${repository}/compare/${stableTag}...${tag}`;
  return `Full comparison since [${stableTag}](${compareUrl})\n\n${generated}`;
}

function expectedVsixNames(version) {
  return vsixVariants.flatMap(([, prefix]) => vsixTargets.map((target) => `${prefix}-${version}-${target}.vsix`));
}

function baseName(filePath) {
  return filePath.split(/[\\/]/).pop();
}

function resolveVsixFiles(version, paths) {
  const byName = new Map();
  for (const filePath of paths) {
    byName.set(baseName(filePath), filePath);
  }
  const missing = [];
  const resolved = {};
  for (const [variant, prefix] of vsixVariants) {
    resolved[variant] = vsixTargets.map((target) => {
      const name = `${prefix}-${version}-${target}.vsix`;
      if (!byName.has(name)) {
        missing.push(name);
      }
      return byName.get(name);
    });
  }
  if (missing.length > 0) {
    throw new Error(`Missing VSIX files: ${missing.join(', ')}`);
  }
  return resolved;
}

function missingAssets(existingNames, paths) {
  const existing = new Set(existingNames);
  return paths.filter((filePath) => !existing.has(baseName(filePath)));
}

function evaluateTestGate(runs, sha = 'the tagged commit') {
  const succeeded = runs.find((run) => run.status === 'completed' && run.conclusion === 'success');
  if (succeeded) {
    return { pass: true, reason: 'success', message: `Tests passed for ${sha}: ${succeeded.html_url}` };
  }
  if (runs.some((run) => run.status !== 'completed')) {
    return {
      pass: false,
      reason: 'in-progress',
      message: `Tests for ${sha} are still running. Re-run this workflow by tag once the tests finish.`,
    };
  }
  if (runs.length > 0) {
    const conclusions = runs.map((run) => run.conclusion).join(', ');
    return {
      pass: false,
      reason: 'failed',
      message: `No successful "Run tests" run for ${sha}; conclusions: ${conclusions}.`,
    };
  }
  return {
    pass: false,
    reason: 'absent',
    message: `No "Run tests" run exists for ${sha}. The tag must be on a tested PR merge commit.`,
  };
}

function publishToMarketplace(files, runPublish, log) {
  const published = [];
  const skipped = [];
  for (const file of files) {
    const { status, output } = runPublish(file);
    if (status === 0) {
      published.push(file);
    } else if (output.includes('already exists')) {
      log(`Already published, skipping: ${file}`);
      skipped.push(file);
    } else {
      log(output);
      throw new Error(`Failed to publish ${file} (exit status ${status}):
${output}`);
    }
  }
  return { published, skipped };
}

const botIdentity = [
  '-c',
  'user.name=github-actions[bot]',
  '-c',
  'user.email=41898282+github-actions[bot]@users.noreply.github.com',
];
const versionFiles = ['package-lock.json', 'package.json'];

function runCommand(command, args, { cwd }) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32' && command === 'npm',
  });
}

function readPackageVersion(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).version;
}

function assertOnlyVersionFilesChanged(changed) {
  const names = changed
    .split(/\r?\n/)
    .filter((name) => name !== '')
    .sort();
  if (names.join('\n') !== versionFiles.join('\n')) {
    throw new Error(`Expected only ${versionFiles.join(' and ')} to change, got: ${names.join(', ') || 'nothing'}.`);
  }
}

function recordVersion({ cwd, version, attempts = 5, exec = runCommand, log = console.log }) {
  const run = (command, args) => exec(command, args, { cwd });
  for (let attempt = 1; attempt <= attempts; attempt++) {
    run('git', ['fetch', 'origin', 'main']);
    run('git', ['checkout', '-B', 'main', 'origin/main']);
    const current = readPackageVersion(cwd);
    if (compareVersions(version, current) <= 0) {
      log(`main already at ${current}; nothing to record for ${version}.`);
      return { changed: false };
    }
    run('npm', ['version', version, '--no-git-tag-version', '--ignore-scripts']);
    assertOnlyVersionFilesChanged(run('git', ['diff', '--name-only']));
    run('git', ['add', ...versionFiles]);
    run('git', [...botIdentity, 'commit', '-m', `chore(release): set version to ${version}`]);
    try {
      run('git', ['push', 'origin', 'HEAD:refs/heads/main']);
      return { changed: true, attempt };
    } catch {
      log(`Push rejected, retrying on the new main tip (attempt ${attempt}/${attempts}).`);
    }
  }
  throw new Error(`Could not record version ${version} on main after ${attempts} attempts.`);
}

function listFilesRecursively(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursively(fullPath) : [fullPath];
  });
}

function runComposeNotes(args) {
  if (args.length !== 5) {
    throw new Error(usage);
  }
  const [isTest, stableTag, tag, serverUrl, repository] = args;
  const generated = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  const body = composeReleaseNotes({ isTest: isTest === 'true', stableTag, tag, serverUrl, repository, generated });
  process.stdout.write(`${body}\n`);
}

function runVsixFiles(args) {
  if (args.length !== 3) {
    throw new Error(usage);
  }
  const [version, variant, dir] = args;
  if (variant !== 'all' && !vsixVariants.some(([name]) => name === variant)) {
    throw new Error(`Variant must be full, noace or all, got ${variant}.`);
  }
  const resolved = resolveVsixFiles(version, listFilesRecursively(dir));
  const selected = variant === 'all' ? [...resolved.full, ...resolved.noace] : resolved[variant];
  console.log(selected.join('\n'));
}

function runMissingAssets(args) {
  if (args.length < 1) {
    throw new Error(usage);
  }
  const [namesFile, ...paths] = args;
  const existingNames = fs
    .readFileSync(namesFile, 'utf8')
    .split(/\r?\n/)
    .filter((name) => name !== '');
  const missing = missingAssets(existingNames, paths);
  for (const filePath of paths) {
    if (!missing.includes(filePath)) {
      console.error(`Asset already attached, skipping: ${baseName(filePath)}`);
    }
  }
  if (missing.length > 0) {
    console.log(missing.join('\n'));
  }
}

function runVscePublish(file) {
  const result = spawnSync('vsce', ['publish', '--azure-credential', '--packagePath', file], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? result.error.message : ''}`;
  process.stdout.write(output);
  return { status: result.status ?? 1, output };
}

function runPublishMarketplace(args) {
  if (args.length < 1) {
    throw new Error(usage);
  }
  const { published, skipped } = publishToMarketplace(args, runVscePublish, (line) => console.error(line));
  console.log(`Published ${published.length} file(s), skipped ${skipped.length} already published.`);
}

function runRecordVersion(args) {
  if (args.length !== 1) {
    throw new Error(usage);
  }
  recordVersion({ cwd: process.cwd(), version: args[0] });
}

function runClassify(args) {
  if (args.length !== 1) {
    throw new Error(usage);
  }
  console.log(formatClassification(classifyTag(args[0])));
}

function runPromotion(args) {
  if (args.length < 1 || args.length > 2) {
    throw new Error(usage);
  }
  console.log(promotionAction(args[0], args[1]));
}

function runIsNextVersion(args) {
  if (args.length !== 2) {
    throw new Error(usage);
  }
  const [current, candidate] = args;
  if (!isNextVersion(current, candidate)) {
    throw new Error(`Test base ${candidate} is not the next patch, minor, or major after ${current}.`);
  }
}

function runTestGate(args) {
  if (args.length !== 1) {
    throw new Error(usage);
  }
  const runs = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!Array.isArray(runs)) {
    throw new Error('Expected a JSON array of workflow runs on stdin.');
  }
  const result = evaluateTestGate(runs, args[0]);
  if (result.pass) {
    console.log(result.message);
  } else {
    console.error(result.message);
    process.exitCode = 1;
  }
}

const commands = new Map([
  ['classify', runClassify],
  ['is-next-version', runIsNextVersion],
  ['compose-notes', runComposeNotes],
  ['vsix-files', runVsixFiles],
  ['missing-assets', runMissingAssets],
  ['test-gate', runTestGate],
  ['publish-marketplace', runPublishMarketplace],
  ['record-version', runRecordVersion],
  ['promotion', runPromotion],
]);

function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    const run = commands.get(command);
    if (!run) {
      throw new Error(usage);
    }
    run(args);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  classifyTag,
  compareVersions,
  composeReleaseNotes,
  evaluateTestGate,
  expectedVsixNames,
  missingAssets,
  promotionAction,
  publishToMarketplace,
  recordVersion,
  resolveVsixFiles,
  runCommand,
};
