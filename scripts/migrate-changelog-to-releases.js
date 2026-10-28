#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const defaultRepo = 'codescene-oss/codescene-vscode';
const startMarker = '<!-- changelog-migration:start -->';
const endMarker = '<!-- changelog-migration:end -->';
const versionHeading = /^#{2,3} \[?(\d+\.\d+\.\d+)\]?(?=[(\s]|$)/;
const stableTag = /^v\d+\.\d+\.\d+$/;
const usage = 'Usage: migrate-changelog-to-releases.js [--file <path>] [--repo <owner/name>] [--apply]';
const historyHint = 'CHANGELOG.md deletion not found in git history; pass --file <path>.';

function defaultExec(command, args, { cwd } = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

function parseChangelog(text) {
  const sections = [];
  const seen = new Set();
  let current;
  for (const line of text.split(/\r?\n/)) {
    const match = versionHeading.exec(line);
    if (match) {
      const version = match[1];
      if (seen.has(version)) {
        throw new Error(`Duplicate changelog section for version ${version}.`);
      }
      seen.add(version);
      current = { version, lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map(({ version, lines }) => ({ version, body: lines.join('\n').trim() }));
}

function readChangelogFromHistory(cwd, exec = defaultExec) {
  const sha = exec('git', ['log', '-1', '--diff-filter=D', '--format=%H', '--', 'CHANGELOG.md'], { cwd }).trim();
  if (sha === '') {
    throw new Error(historyHint);
  }
  return exec('git', ['show', `${sha}^:CHANGELOG.md`], { cwd });
}

function changelogBlock(section) {
  return `${startMarker}\n## Changelog\n\n${section}\n${endMarker}\n`;
}

function stripChangelogBlock(body) {
  const start = body.indexOf(startMarker);
  const end = body.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    return body;
  }
  const before = body.slice(0, start).trimEnd();
  const after = body.slice(end + endMarker.length).trim();
  return after === '' ? before : `${before}\n\n${after}`;
}

function applyChangelogBlock(body, section) {
  const existing = stripChangelogBlock(body).trimEnd();
  return existing === '' ? changelogBlock(section) : `${existing}\n\n${changelogBlock(section)}`;
}

function planMigration(sections, releases) {
  const targets = new Map(
    releases
      .filter((release) => release.draft === false && release.prerelease === false && stableTag.test(release.tag_name))
      .map((release) => [release.tag_name, release])
  );
  const plan = { updates: [], upToDate: [], unmatched: [], empty: [] };
  for (const { version, body: section } of sections) {
    const tag = `v${version}`;
    const release = targets.get(tag);
    if (!release) {
      plan.unmatched.push(version);
    } else if (section === '') {
      plan.empty.push(version);
    } else {
      const body = release.body ?? '';
      const newBody = applyChangelogBlock(body, section);
      if (newBody === body) {
        plan.upToDate.push(tag);
      } else {
        plan.updates.push({ id: release.id, tag, body, newBody });
      }
    }
  }
  return plan;
}

function createGitHub(repo, exec = defaultExec) {
  return {
    listReleases() {
      const pages = JSON.parse(
        exec('gh', ['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`], { cwd: process.cwd() })
      );
      return pages.flat().map(({ id, tag_name, draft, prerelease, body }) => ({ id, tag_name, draft, prerelease, body }));
    },
    updateReleaseBody(id, body) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-changelog-migration-'));
      try {
        const file = path.join(dir, 'body.md');
        fs.writeFileSync(file, body);
        exec('gh', ['api', '-X', 'PATCH', `repos/${repo}/releases/${id}`, '-F', `body=@${file}`], { cwd: process.cwd() });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

function readOptionValue(argv, index) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${argv[index]}. ${usage}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = { file: undefined, repo: defaultRepo, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--file' || arg === '--repo') {
      options[arg.slice(2)] = readOptionValue(argv, i++);
    } else {
      throw new Error(`Unknown option ${arg}. ${usage}`);
    }
  }
  return options;
}

function listOrNone(items) {
  return items.length === 0 ? 'none' : items.join(', ');
}

function run(argv, deps) {
  const { cwd, readFile, readChangelogFromHistory: readHistory, github, log } = deps;
  const options = parseArgs(argv);
  const text = options.file ? readFile(path.resolve(cwd, options.file)) : readHistory(cwd);
  const plan = planMigration(parseChangelog(text), github.listReleases());
  for (const { id, tag, newBody } of plan.updates) {
    log(`${options.apply ? 'Updating' : 'Would update'} ${tag}:`);
    log(newBody.slice(newBody.lastIndexOf(startMarker)));
    if (options.apply) {
      github.updateReleaseBody(id, newBody);
      log(`Updated ${tag}`);
    }
  }
  log(`Up to date: ${listOrNone(plan.upToDate)}`);
  log(`Changelog sections without a stable release: ${listOrNone(plan.unmatched)}`);
  log(`Empty changelog sections: ${listOrNone(plan.empty)}`);
  if (!options.apply) {
    log(`Dry run: ${plan.updates.length} release(s) would be updated. Pass --apply to write.`);
  }
  return plan;
}

function main() {
  try {
    const argv = process.argv.slice(2);
    const { repo } = parseArgs(argv);
    run(argv, {
      cwd: process.cwd(),
      readFile: (file) => fs.readFileSync(file, 'utf8'),
      readChangelogFromHistory,
      github: createGitHub(repo),
      log: console.log,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  applyChangelogBlock,
  createGitHub,
  parseChangelog,
  planMigration,
  readChangelogFromHistory,
  run,
};
