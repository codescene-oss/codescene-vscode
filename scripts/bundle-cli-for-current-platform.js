#!/usr/bin/env node

/**
 * Bundle CLI binary for the current platform/architecture.
 * This is a convenience script for local development and testing.
 */

const { bundleBinaryForPlatform } = require('./bundle-cli.js');

const platform = process.platform;
const arch = process.arch;

console.log(`Bundling CLI binary for current platform: ${platform}/${arch}\n`);

bundleBinaryForPlatform(platform, arch)
  .then(() => {
    console.log(`\n✅ Successfully bundled binary for ${platform}/${arch}!`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n❌ Failed to bundle binary:`, error.message);
    process.exit(1);
  });

