#!/usr/bin/env node

/**
 * Apply or restore build-variant changes to package.json and README.md for no-ACE releases.
 */

const fs = require('fs');
const path = require('path');

const NO_ACE_NAME = 'codescene-vscode-noace';
const SIDE_BY_SIDE_NOTICE =
  '> Do not install this extension alongside CodeScene (`codescene.codescene-vscode`). Uninstall one before installing the other.';

function withSideBySideNotice(readme) {
  const eol = readme.includes('\r\n') ? '\r\n' : '\n';
  const lines = readme.split(eol);
  const badgeAt = lines.findIndex((line) => line.startsWith('[![CodeScene Code Health]'));
  lines.splice(badgeAt + 1, 0, '', SIDE_BY_SIDE_NOTICE);
  return lines.join(eol);
}

function applyNoAceVariant(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const readmePath = path.join(projectRoot, 'README.md');

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  pkg.name = NO_ACE_NAME;
  pkg.displayName = 'CodeScene w/o ACE';
  pkg.description = `${pkg.description} Do not install alongside CodeScene (codescene.codescene-vscode).`;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);

  if (fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, withSideBySideNotice(fs.readFileSync(readmePath, 'utf8')));
  }

  return pkg;
}

function restoreVariantFiles(projectRoot, originalPackageJson, originalReadme) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const readmePath = path.join(projectRoot, 'README.md');

  fs.writeFileSync(packageJsonPath, originalPackageJson);
  if (originalReadme !== undefined) {
    fs.writeFileSync(readmePath, originalReadme);
  }
}

function isNoAceBuild() {
  return process.env.BUILD_NO_ACE === 'true';
}

module.exports = {
  applyNoAceVariant,
  restoreVariantFiles,
  isNoAceBuild,
};
