#!/usr/bin/env node

/**
 * Apply or restore build-variant changes to package.json and README.md for no-ACE releases.
 */

const fs = require('fs');
const path = require('path');

const ACE_KEYWORDS = new Set([
  'refactoring',
  'ai',
  'anthropic',
  'openai',
  'gemini',
  'gpt',
  'ai code review',
]);

const ACE_SETTINGS = ['codescene.enableAutoRefactor', 'codescene.authToken'];

function applyNoAceVariant(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const readmePath = path.join(projectRoot, 'README.md');
  const noAceReadmePath = path.join(projectRoot, 'README-noace.md');

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  pkg.name = 'codescene-vscode-noace';
  pkg.displayName = 'CodeScene w/o ACE';
  pkg.description =
    'CodeScene code analysis without ACE. Do not install alongside CodeScene (codescene.codescene-vscode).';
  pkg.keywords = (pkg.keywords || []).filter((keyword) => !ACE_KEYWORDS.has(keyword));

  const properties = pkg.contributes?.configuration?.properties;
  if (properties) {
    for (const key of ACE_SETTINGS) {
      delete properties[key];
    }
  }

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);

  if (fs.existsSync(noAceReadmePath)) {
    fs.copyFileSync(noAceReadmePath, readmePath);
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
