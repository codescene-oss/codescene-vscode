#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const localCwfDir = path.join(projectRoot, '..', 'cs-webview');
const targetDir = path.join(projectRoot, 'cs-cwf');

function buildLocally() {
  console.log(`Building CWF locally from ${localCwfDir}...`);
  execSync('npm run build', { cwd: localCwfDir, stdio: 'inherit' });
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(path.join(localCwfDir, 'build'), targetDir, { recursive: true });
  console.log(`CWF built and copied to ${targetDir}`);
}

function downloadRelease() {
  console.log('Downloading CWF from GitHub releases...');
  execSync('npm run updatecwf', { cwd: projectRoot, stdio: 'inherit' });
}

if (fs.existsSync(localCwfDir) && !process.env.CI) {
  buildLocally();
} else {
  downloadRelease();
}
