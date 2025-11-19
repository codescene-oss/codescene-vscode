/**
 * Shared configuration for CLI artifacts and version.
 * This file is used by both TypeScript source files and build scripts.
 */

export const requiredDevtoolsVersion = '5a24d744e6af8f69ff1d6098dabf318fe7f9c699';

export const artifacts: { [platform: string]: { [arch: string]: string } } = {
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

