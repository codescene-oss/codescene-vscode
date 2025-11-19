/**
 * Shared configuration for CLI artifacts and version.
 * This JavaScript file is the single source of truth for CLI configuration.
 * It is used by:
 * - Build scripts (bundle-cli.js) that run before TypeScript compilation
 * - TypeScript source files (via artifact-info.ts) that import from this file
 */

const requiredDevtoolsVersion = '5a24d744e6af8f69ff1d6098dabf318fe7f9c699';

const artifacts = {
  darwin: {
    x64: `cs-ide-macos-amd64-${requiredDevtoolsVersion}.zip`,
    arm64: `cs-ide-macos-aarch64-${requiredDevtoolsVersion}.zip`,
  },
  linux: {
    x64: `cs-ide-linux-amd64-${requiredDevtoolsVersion}.zip`,
    arm64: `cs-ide-linux-aarch64-${requiredDevtoolsVersion}.zip`,
  },
  win32: {
    x64: `cs-ide-windows-amd64-${requiredDevtoolsVersion}.zip`,
  },
};

module.exports = {
  requiredDevtoolsVersion,
  artifacts,
};

